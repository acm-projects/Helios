import { Request, Response } from "express";
import bcrypt from "bcrypt";
import { User } from "./user.model.js";
import { signToken } from "./jwt.service.js";

const SALT_ROUNDS = 12;

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function register(req: Request, res: Response) {
  try {
    const { email, password } = req.body as { email?: string; password?: string };

    if (!email || !password) {
      res.status(400).json({ error: "Email and password are required" });
      return;
    }

    if (!isValidEmail(email)) {
      res.status(400).json({ error: "Invalid email format" });
      return;
    }

    if (password.length < 8) {
      res.status(400).json({ error: "Password must be at least 8 characters" });
      return;
    }

    const normalizedEmail = email.toLowerCase().trim();
    const existing = await User.findOne({ email: normalizedEmail }).lean();

    if (existing) {
      res.status(409).json({ error: "Email already registered" });
      return;
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await User.create({ email: normalizedEmail, passwordHash });
    const token = signToken(String(user._id));

    res.status(201).json({
      token,
      user: {
        _id: String(user._id),
        email: user.email,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    });
  } catch (error: any) {
    if (error?.code === 11000) {
      res.status(409).json({ error: "Email already registered" });
      return;
    }
    res.status(500).json({ error: "Failed to register user" });
  }
}

export async function login(req: Request, res: Response) {
  try {
    const { email, password } = req.body as { email?: string; password?: string };

    if (!email || !password) {
      res.status(400).json({ error: "Email and password are required" });
      return;
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const token = signToken(String(user._id));
    res.json({
      token,
      user: {
        _id: String(user._id),
        email: user.email,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    });
  } catch {
    res.status(500).json({ error: "Failed to login" });
  }
}

export async function me(req: Request, res: Response) {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const user = await User.findById(userId).lean();
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json({
      user: {
        _id: String(user._id),
        email: user.email,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    });
  } catch {
    res.status(500).json({ error: "Failed to fetch user" });
  }
}
