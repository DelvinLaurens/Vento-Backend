import express, { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const app = express();
const prisma = new PrismaClient();
const SECRET_KEY = process.env.SECRET_KEY || "VENTO123";

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
app.post('/auth/login', async (req: Request, res: Response) => {
  const { username, password } = req.body;
  const user = await prisma.user.findUnique({ where: { username } });

  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ message: "Username atau Password salah" });
  }

  const token = jwt.sign({ userId: user.id, role: user.role }, SECRET_KEY, { expiresIn: '1d' });
  res.json({ user: { id: user.id, namaToko: user.namaToko, role: user.role }, token });
});

app.post('/auth/register', async (req: Request, res: Response) => {
  const { username, password, namaToko, adminSecret } = req.body;
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  let isAuthorized = false;
  let roleUser = "USER";

  if (adminSecret === "VENTO_OWNER_SECRET_2026") {
    isAuthorized = true;
    roleUser = "ADMIN";
  } else if (token) {
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
    return res.status(401).json({ message: "Akses ditolak!" });
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

// --- ADMIN AREA ---
app.get('/admin/users', authenticateToken, async (req: any, res) => {
  if (req.user.role !== 'ADMIN') return res.status(403).json({ message: "Akses Ditolak" });
  const users = await prisma.user.findMany({
    include: { _count: { select: { items: true } } },
    orderBy: { id: 'asc' }
  });
  res.json(users);
});

app.delete('/admin/users/:id', authenticateToken, async (req: any, res) => {
  if (req.user.role !== 'ADMIN') return res.status(403).json({ message: "Akses Ditolak" });
  try {
    const userId = Number(req.params.id);
    await prisma.$transaction([
      prisma.activityLog.deleteMany({ where: { userId } }),
      prisma.item.deleteMany({ where: { userId } }),
      prisma.user.delete({ where: { id: userId } })
    ]);
    res.json({ message: "User dihapus total" });
  } catch (e) { res.status(400).json({ message: "Gagal hapus" }); }
});

// --- INVENTORY API ---
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
        data: { aksi: "TAMBAH", rincian: `Menambah: ${nama}`, userId, itemId: newItem.id }
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
      const updatedItem = await tx.item.update({
        where: { id: Number(req.params.id) },
        data: { nama, harga: Number(harga), stok: Number(stok), kategori, satuan }
      });
      await tx.activityLog.create({
        data: { aksi: "EDIT", rincian: `Update: ${nama}`, userId, itemId: updatedItem.id }
      });
      return updatedItem;
    });
    res.json(result);
  } catch (e) { res.status(400).json({ message: "Gagal update" }); }
});

app.delete('/items/:id', authenticateToken, async (req: any, res) => {
  const userId = Number(req.user.userId);
  try {
    const item = await prisma.item.findUnique({ where: { id: Number(req.params.id) } });
    await prisma.$transaction([
      prisma.activityLog.create({
        data: { aksi: "HAPUS", rincian: `Hapus: ${item?.nama}`, userId, itemId: null }
      }),
      prisma.item.delete({ where: { id: Number(req.params.id) } })
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

// --- JALANKAN SERVER ---
const serverPort: number = Number(process.env.PORT) || 8000;

app.listen(serverPort, '0.0.0.0', () => {
  console.log(`Vento Backend running on port ${serverPort}`);
});