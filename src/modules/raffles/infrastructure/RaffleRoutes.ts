import { Router } from "express";
import { RaffleController } from "./RaffleController";
import { PrismaRaffleRepository } from "./PrismaRaffleRepository";
import {
  CreateRaffleUseCase,
  EditRaffleUseCase,
  CancelRaffleUseCase,
  DeleteRaffleUseCase,
  DrawRaffleUseCase,
  GetUpcomingRafflesUseCase,
  GetClientRafflesUseCase,
  GetAdminRafflesUseCase,
  GetRaffleDetailsUseCase,
  SetRaffleVisibilityUseCase,
} from "../application/RaffleUseCases";
import {
  authMiddleware,
  adminOnly,
} from "../../../shared/infrastructure/middlewares/authMiddleware";
import multer from "multer";
import path from "path";
import fs from "fs";

const router = Router();

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = path.join(process.cwd(), "storage", "avatars");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, `bot_${Date.now()}_${Math.random().toString(36).substring(2, 8)}${ext}`);
  }
});
const uploadAvatar = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Serve avatars statically
router.use("/avatars", require("express").static(path.join(process.cwd(), "storage", "avatars")));

const raffleRepository = new PrismaRaffleRepository();
const createRaffleUseCase = new CreateRaffleUseCase(raffleRepository);
const editRaffleUseCase = new EditRaffleUseCase(raffleRepository);
const cancelRaffleUseCase = new CancelRaffleUseCase(raffleRepository);
const deleteRaffleUseCase = new DeleteRaffleUseCase(raffleRepository);
const drawRaffleUseCase = new DrawRaffleUseCase(raffleRepository);
const getUpcomingRafflesUseCase = new GetUpcomingRafflesUseCase(raffleRepository);
const getClientRafflesUseCase = new GetClientRafflesUseCase(raffleRepository);
const getAdminRafflesUseCase = new GetAdminRafflesUseCase(raffleRepository);
const getRaffleDetailsUseCase = new GetRaffleDetailsUseCase(raffleRepository);
const setRaffleVisibilityUseCase = new SetRaffleVisibilityUseCase(raffleRepository);

const raffleController = new RaffleController(
  createRaffleUseCase,
  editRaffleUseCase,
  cancelRaffleUseCase,
  deleteRaffleUseCase,
  drawRaffleUseCase,
  getUpcomingRafflesUseCase,
  getClientRafflesUseCase,
  getAdminRafflesUseCase,
  getRaffleDetailsUseCase,
  setRaffleVisibilityUseCase
);

// Client Public Routes
router.get("/upcoming", (req, res) => raffleController.getUpcomingRaffles(req, res));
router.get("/", (req, res) => raffleController.getClientRaffles(req, res));
router.get("/:id", (req, res) => raffleController.getRaffleDetails(req, res));
router.get("/:id/winners", (req, res) => raffleController.getRaffleWinners(req, res));

// Admin-only Routes
router.get("/admin/all", authMiddleware, adminOnly, (req, res) =>
  raffleController.getAdminRaffles(req, res)
);
router.get("/admin/bots", authMiddleware, adminOnly, (req, res) =>
  raffleController.getAdminBots(req, res)
);
router.get("/admin/summaries", authMiddleware, adminOnly, (req, res) =>
  raffleController.getAdminRaffleSummaries(req, res)
);
router.get("/admin/orders", authMiddleware, adminOnly, (req, res) =>
  raffleController.getAllRaffleOrders(req, res)
);
router.post("/admin", authMiddleware, adminOnly, (req, res) =>
  raffleController.createRaffle(req, res)
);
router.put("/admin/:id", authMiddleware, adminOnly, (req, res) =>
  raffleController.updateRaffle(req, res)
);
router.patch("/admin/:id/cancel", authMiddleware, adminOnly, (req, res) =>
  raffleController.cancelRaffle(req, res)
);
router.delete("/admin/:id", authMiddleware, adminOnly, (req, res) =>
  raffleController.deleteRaffle(req, res)
);
router.post("/admin/:id/draw", authMiddleware, adminOnly, (req, res) =>
  raffleController.drawRaffle(req, res)
);
router.patch("/admin/:id/visibility", authMiddleware, adminOnly, (req, res) =>
  raffleController.setRaffleVisibility(req, res)
);
router.get("/admin/:id/participants", authMiddleware, adminOnly, (req, res) =>
  raffleController.getRaffleParticipants(req, res)
);
router.get("/admin/:id/orders", authMiddleware, adminOnly, (req, res) =>
  raffleController.getRaffleOrders(req, res)
);
router.get("/admin/:id/orders/:orderId", authMiddleware, adminOnly, (req, res) =>
  raffleController.getRaffleOrderDetail(req, res)
);
router.post("/admin/:id/fake-participants", authMiddleware, adminOnly, uploadAvatar.single("avatarFile"), (req, res) =>
  raffleController.addFakeParticipants(req, res)
);

export default router;
