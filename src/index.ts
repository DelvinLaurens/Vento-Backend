import express, { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const app = express();
const prisma = new PrismaClient();
const PORT = 5000;
const SECRET_KEY = "VENTO123";

app.use(cors());
app.use(express.json());

// --- MIDDLEWARE PENJAGA ---
const authenticateToken = (req: any, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ message: "Token Hilang" });

  jwt.verify(token, SECRET_KEY, (err: any, user: any) => {
    if (err) return res.status(403).json({ message: "Token Tidak Sah" });
    req.user = user;
    next();
  });
};

// --- AUTH API ---

// 1. LOGIN
app.post('/auth/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await prisma.user.findUnique({ where: { username } });

  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ message: "Username atau Password salah" });
  }

  const token = jwt.sign({ userId: user.id, role: user.role }, SECRET_KEY, { expiresIn: '1d' });
  res.json({ user: { id: user.id, namaToko: user.namaToko, role: user.role }, token });
});

// 2. REGISTER (Bisa oleh Admin lewat Token atau Owner lewat Secret Key)
app.post('/auth/register', async (req: Request, res: Response) => {
  const { username, password, namaToko, adminSecret } = req.body;
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  let isAuthorized = false;
  let roleUser = "USER";

  // Jalur 1: Rahasia Owner (Untuk buat Admin pertama kali)
  if (adminSecret === "VENTO_OWNER_SECRET_2026") {
    isAuthorized = true;
    roleUser = "ADMIN";
  } 
  // Jalur 2: Token Admin (Untuk Admin mendaftarkan User baru)
  else if (token) {
    try {
      const decoded: any = jwt.verify(token, SECRET_KEY);
      if (decoded.role === 'ADMIN') {
        isAuthorized = true;
        roleUser = "USER";
      }
    } catch (err) {
      return res.status(403).json({ message: "Token tidak sah" });
    }
  }

  if (!isAuthorized) {
    return res.status(401).json({ message: "Akses ditolak! Token hilang atau Secret Key salah." });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    await prisma.user.create({ 
      data: { username, password: hashedPassword, namaToko, role: roleUser } 
    });
    res.status(201).json({ message: `Berhasil mendaftar sebagai ${roleUser}` });
  } catch (e) { 
    res.status(400).json({ message: "Username sudah digunakan" }); 
  }
});

// --- ADMIN AREA (Hanya bisa diakses ROLE ADMIN) ---

app.get('/admin/users', authenticateToken, async (req: any, res) => {
  if (req.user.role !== 'ADMIN') return res.status(403).json({ message: "Akses Ditolak" });
  const users = await prisma.user.findMany({
    include: { _count: { select: { items: true } } },
    orderBy: { id: 'asc' }
  });
  res.json(users);
});

app.put('/admin/users/:id', authenticateToken, async (req: any, res) => {
  if (req.user.role !== 'ADMIN') return res.status(403).json({ message: "Akses Ditolak" });
  const { username, namaToko, role } = req.body;
  try {
    const updated = await prisma.user.update({
      where: { id: Number(req.params.id) },
      data: { username, namaToko, role }
    });
    res.json(updated);
  } catch (e) { res.status(400).json({ message: "Gagal update" }); }
});

app.delete('/admin/users/:id', authenticateToken, async (req: any, res) => {
  if (req.user.role !== 'ADMIN') return res.status(403).json({ message: "Akses Ditolak" });
  const userId = Number(req.params.id);
  try {
    await prisma.$transaction([
      prisma.activityLog.deleteMany({ where: { userId } }),
      prisma.item.deleteMany({ where: { userId } }),
      prisma.user.delete({ where: { id: userId } })
    ]);
    res.json({ message: "User dihapus total" });
  } catch (e) { res.status(400).json({ message: "Gagal hapus" }); }
});

// --- API GUDANG (DENGAN LOG AKTIVITAS) ---

app.get('/items', authenticateToken, async (req: any, res) => {
  const items = await prisma.item.findMany({ 
    where: { userId: Number(req.user.userId) },
    orderBy: { id: 'desc' }
  });
  res.json(items);
});

app.post('/items', authenticateToken, async (req: any, res) => {
  const { nama, harga, stok, kategori, satuan, barcode } = req.body;
  const userId = Number(req.user.userId);
  try {
    const result = await prisma.$transaction(async (tx) => {
      const newItem = await tx.item.create({
        data: { nama, harga: Number(harga), stok: Number(stok), kategori, satuan, barcode, userId }
      });
      await tx.activityLog.create({
        data: { aksi: "TAMBAH", rincian: `Menambah: ${nama} (${stok} ${satuan})`, userId, itemId: newItem.id }
      });
      return newItem;
    });
    res.json(result);
  } catch (e) { res.status(400).json({ message: "Gagal simpan" }); }
});

app.put('/items/:id', authenticateToken, async (req: any, res) => {
  const { nama, harga, stok, kategori, satuan } = req.body;
  const userId = Number(req.user.userId);
  try {
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.item.update({
        where: { id: Number(req.params.id) },
        data: { nama, harga: Number(harga), stok: Number(stok), kategori, satuan }
      });
      await tx.activityLog.create({
        data: { aksi: "EDIT", rincian: `Update: ${nama}`, userId, itemId: updated.id }
      });
      return updated;
    });
    res.json(result);
  } catch (e) { res.status(400).json({ message: "Gagal update" }); }
});

app.delete('/items/:id', authenticateToken, async (req: any, res) => {
  const userId = Number(req.user.userId);
  const itemId = Number(req.params.id);
  try {
    const item = await prisma.item.findUnique({ where: { id: itemId } });
    await prisma.$transaction([
      prisma.activityLog.create({
        data: { aksi: "HAPUS", rincian: `Hapus: ${item?.nama}`, userId, itemId: null }
      }),
      prisma.item.delete({ where: { id: itemId } })
    ]);
    res.json({ message: "Deleted" });
  } catch (e) { res.status(400).json({ message: "Gagal hapus" }); }
});

app.get('/logs', authenticateToken, async (req: any, res) => {
  const logs = await prisma.activityLog.findMany({
    where: { userId: Number(req.user.userId) },
    orderBy: { createdAt: 'desc' },
    take: 15
  });
  res.json(logs);
});

// RESET PASSWORD (ADMIN ONLY SECRET)
app.put('/admin/reset-password', async (req: Request, res: Response) => {
  const { username, newPassword, adminSecret } = req.body;
  if (adminSecret !== "VENTO_OWNER_KODE_99") return res.status(403).json({ message: "Ditolak" });
  try {
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({ where: { username }, data: { password: hashedPassword } });
    res.json({ message: `Password ${username} diganti!` });
  } catch (e) { res.status(400).json({ message: "User tidak ditemukan" }); }
});

const PORT = process.env.PORT || 5000; // Render akan memberikan PORT otomatis
app.listen(PORT, '0.0.0.0', () => console.log(`Vento Backend Online di Port ${PORT}`));