import { Router } from "express";
import { login, me, register } from "./auth.controller.js";
import { authMiddleware } from "./auth.middleware.js";

const authRouter = Router();

authRouter.post("/register", register);
authRouter.post("/login", login);
authRouter.get("/me", authMiddleware, me);

export default authRouter;
