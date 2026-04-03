import jwt, { JwtPayload, SignOptions } from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET is not set in environment variables");
}

const jwtSecret: string = JWT_SECRET;

export function signToken(userId: string): string {
  const options: SignOptions = {
    algorithm: "HS256",
    expiresIn: "7d",
  };

  return jwt.sign({ userId }, jwtSecret, options);
}

export function verifyToken(token: string): { userId: string } {
  const decoded = jwt.verify(token, jwtSecret, {
    algorithms: ["HS256"],
  }) as JwtPayload;

  if (!decoded || typeof decoded.userId !== "string") {
    throw new Error("Invalid token payload");
  }

  return { userId: decoded.userId };
}
