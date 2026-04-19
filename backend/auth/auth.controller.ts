import { Request, Response } from "express";
import bcrypt from "bcrypt";
import { OAuth2Client } from "google-auth-library";
import { randomBytes } from "crypto";
import { User } from "./user.model.js";
import { signToken } from "./jwt.service.js";

const oauth2Client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
)

// In-memory CSRF state store — maps state token → expiry timestamp
const pendingStates = new Map<string, number>()

// One-time code store — maps code → { userId, expiry }
const pendingTokens = new Map<string, { userId: string; expiry: number }>()

const SALT_ROUNDS = 10;

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

// Step 1 — redirect user to Google's consent screen
export async function googleRedirect(req: Request, res: Response) {
  // Evict expired entries before adding a new one — prevents unbounded accumulation
  const now = Date.now()
  for (const [k, expiry] of pendingStates) {
    if (expiry < now) pendingStates.delete(k)
  }

  // Hard cap — bots or abandoned flows can't grow the map beyond this
  if (pendingStates.size > 500) {
    return res.status(429).json({ error: "Too many pending auth sessions. Try again shortly." })
  }

  const state = randomBytes(16).toString("hex")
  pendingStates.set(state, Date.now() + 10 * 60 * 1000) // expires in 10 min

  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: ["email", "profile"],
    state,
    prompt: "select_account",
  })

  res.redirect(url)
}

// Step 2 — Google redirects here with ?code=...&state=...
export async function googleCallback(req: Request, res: Response) {
  const { code, state } = req.query as { code?: string; state?: string }
  const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000"

  // CSRF check — state must match what we issued and not be expired
  const expiry = state ? pendingStates.get(state) : undefined
  if (!state || !expiry || expiry < Date.now()) {
    pendingStates.delete(state!)
    return res.redirect(`${FRONTEND_URL}/auth?error=invalid_state`)
  }
  pendingStates.delete(state)

  if (!code) {
    return res.redirect(`${FRONTEND_URL}/auth?error=no_code`)
  }

  try {
    // Exchange authorization code for tokens
    const { tokens } = await oauth2Client.getToken(code)

    // Verify the ID token and extract user info
    const ticket = await oauth2Client.verifyIdToken({
      idToken: tokens.id_token!,
      audience: process.env.GOOGLE_CLIENT_ID!,
    })
    const payload = ticket.getPayload()!
    const googleId = payload.sub
    const email = payload.email!.toLowerCase()
    const name = payload.name ?? null
    const picture = payload.picture ?? null

    // Find existing user by googleId or email, or create a new one
    let user = await User.findOne({ $or: [{ googleId }, { email }] })

    if (!user) {
      user = await User.create({ email, googleId, name, picture })
    } else if (!user.googleId) {
      // Existing email/password account — link the Google ID
      user.googleId = googleId
      user.name = user.name ?? name
      user.picture = user.picture ?? picture
      await user.save()
    }

    // Issue a one-time code instead of the JWT — keeps the token out of the URL
    const oneTimeCode = randomBytes(32).toString("hex")
    pendingTokens.set(oneTimeCode, { userId: String(user._id), expiry: Date.now() + 60_000 })
    res.redirect(`${FRONTEND_URL}/auth/callback?code=${oneTimeCode}`)
  } catch {
    res.redirect(`${FRONTEND_URL}/auth?error=google_failed`)
  }
}

export async function exchangeCode(req: Request, res: Response) {
  const { code } = req.body as { code?: string }

  if (!code || typeof code !== "string") {
    return res.status(400).json({ error: "Missing code" })
  }

  const entry = pendingTokens.get(code)
  pendingTokens.delete(code) // always delete — one-time use

  if (!entry || entry.expiry < Date.now()) {
    return res.status(410).json({ error: "Code expired or invalid" })
  }

  const token = signToken(entry.userId)
  return res.json({ token })
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
