import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { getPool } from '../db';
import { seedSystemLists } from './library.service';

interface UserRow extends RowDataPacket {
  id: number;
  username: string;
  password_hash: string;
}

interface RefreshRow extends RowDataPacket {
  user_id: number;
}

export async function findUserByUsername(username: string): Promise<UserRow | null> {
  const [rows] = await getPool().query<UserRow[]>(
    'SELECT id, username, password_hash FROM users WHERE username = ?',
    [username],
  );
  return rows[0] ?? null;
}

export async function findUserById(id: number): Promise<UserRow | null> {
  const [rows] = await getPool().query<UserRow[]>(
    'SELECT id, username, password_hash FROM users WHERE id = ?',
    [id],
  );
  return rows[0] ?? null;
}

export async function updateUsername(id: number, newUsername: string): Promise<void> {
  const existing = await findUserByUsername(newUsername);
  if (existing && existing.id !== id) throw new Error('Username already taken');
  await getPool().query('UPDATE users SET username = ? WHERE id = ?', [newUsername, id]);
}

export async function updatePassword(id: number, currentPassword: string, newPassword: string): Promise<void> {
  const user = await findUserById(id);
  if (!user) throw new Error('User not found');
  const valid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!valid) throw new Error('Current password is incorrect');
  const hash = await bcrypt.hash(newPassword, 10);
  await getPool().query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, id]);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function createAccessToken(userId: number): string {
  return jwt.sign(
    { sub: userId },
    process.env.JWT_SECRET || 'dev-secret-change-me',
    { expiresIn: '15m' },
  );
}

export async function createRefreshToken(userId: number): Promise<string> {
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await getPool().query(
    'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
    [userId, token, expiresAt],
  );
  return token;
}

export async function validateRefreshToken(token: string): Promise<number | null> {
  const [rows] = await getPool().query<RefreshRow[]>(
    'SELECT user_id FROM refresh_tokens WHERE token = ? AND expires_at > NOW()',
    [token],
  );
  return rows[0]?.user_id ?? null;
}

export async function deleteRefreshToken(token: string): Promise<void> {
  await getPool().query('DELETE FROM refresh_tokens WHERE token = ?', [token]);
}

export async function ensureAdminUser(): Promise<void> {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) return;

  let user = await findUserByUsername(username);
  if (!user) {
    const hash = await bcrypt.hash(password, 10);
    const [res] = await getPool().query<ResultSetHeader>(
      'INSERT INTO users (username, password_hash) VALUES (?, ?)',
      [username, hash],
    );
    console.log(`Created admin user "${username}" (id ${res.insertId})`);
    user = await findUserByUsername(username);
  }

  // Always ensure the seeded system lists exist (idempotent).
  if (user) await seedSystemLists(user.id);
}
