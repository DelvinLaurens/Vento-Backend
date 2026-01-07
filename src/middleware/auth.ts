import express, { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const app = express();
const prisma = new PrismaClient();
const PORT = 5000;
const SECRET_KEY = "VENTO_GUDANG_SECRET"; // Kunci rahasia untuk Token

app.use(cors());
app.use(express.json());

// --- MIDDLEWARE (PENJAGA PINTU) ---
// Fungsi ini akan mengecek apakah orang yang minta data punya "KTP Digital" (Token) yang sah
const authenticateToken = (req: any, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Ambil token dari format "Bearer TOKEN_DISINI"

  if (!token) return res.status(401).json({ message: "Akses ditolak, silakan login!" });

  jwt.verify(token, SECRET_KEY, (err: any, user: any) => {
    if (err) return res.status(403).json({ message: "Sesi habis atau token tidak sah!" });
    req.user = user; // Menyimpan data user (userId) ke dalam request
    next(); // Lanjut ke proses berikutnya
  });
};

// --- AUTH API ---
app.post('/auth/register', async (req: Request, res: Response) => {
  const { username, password, namaToko } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    await prisma.user.create({ data: { username, password: hashedPassword, namaToko } });
    res.status(201).json({ message: "Berhasil mendaftar akun gudang" });
  } catch (e) { res.status(400).json({ message: "ID sudah ada!" }); }
});

app.post('/auth/login', async (req: Request, res: Response) => {
  const { username, password } = req.body;
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ message: "Username atau Password salah!" });
  }
  // Masukkan userId ke dalam Token
  const token = jwt.sign({ userId: user.id }, SECRET_KEY, { expiresIn: '1d' });
  res.json({ user: { id: user.id, namaToko: user.namaToko }, token });
});

// --- API GUDANG (PROTECTED / DILINDUNGI) ---

// 1. Ambil Barang (Hanya milik user yang sedang login)
app.get('/items', authenticateToken, async (req: any, res) => {
  const userId = req.user.userId; 
  const items = await prisma.item.findMany({ 
    where: { userId: Number(userId) },
    orderBy: { id: 'desc' } 
  });
  res.json(items);
});

// 2. Tambah Barang
app.post('/items', authenticateToken, async (req: any, res) => {
  const userId = req.user.userId;
  const { nama, harga, stok, kategori, satuan } = req.body;
  try {
    const item = await prisma.item.create({
      data: { 
        nama, 
        harga: Number(harga), 
        stok: Number(stok), 
        kategori, 
        satuan, 
        userId: Number(userId) 
      }
    });
    res.json(item);
  } catch (e) { res.status(400).json({ message: "Gagal menambah barang" }); }
});

// 3. Update Barang
app.put('/items/:id', authenticateToken, async (req: any, res) => {
  const { nama, harga, stok, kategori, satuan } = req.body;
  try {
    const item = await prisma.item.update({
      where: { id: Number(req.params.id) },
      data: { nama, harga: Number(harga), stok: Number(stok), kategori, satuan }
    });
    res.json(item);
  } catch (e) { res.status(400).json({ message: "Gagal update" }); }
});

// 4. Hapus Barang
app.delete('/items/:id', authenticateToken, async (req: any, res) => {
  try {
    await prisma.item.delete({ where: { id: Number(req.params.id) } });
    res.json({ message: "Barang dihapus" });
  } catch (e) { res.status(400).json({ message: "Gagal hapus" }); }
});

app.listen(PORT, () => console.log(`Vento Warehouse PRO Running on ${PORT}`));