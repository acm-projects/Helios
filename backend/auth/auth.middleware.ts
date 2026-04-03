import { NextFunction, Request, Response } from "express";
import { verifyToken } from "./jwt.service.js";

declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
      };
    }
  }
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.header("Authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const token = authHeader.slice("Bearer ".length).trim();
    const payload = verifyToken(token);
    req.user = { userId: payload.userId };

    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}
