import { Router } from "express";
import { login, me, register, googleRedirect, googleCallback, exchangeCode } from "./auth.controller.js";
import { authMiddleware } from "./auth.middleware.js";

const authRouter = Router();

authRouter.post("/register", register);
authRouter.post("/login", login);
authRouter.get("/me", authMiddleware, me);
authRouter.get("/google", googleRedirect);
authRouter.get("/google/callback", googleCallback);
authRouter.post("/exchange", exchangeCode);

export default authRouter;
