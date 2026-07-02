import { Router } from "express";
import { RaffleController } from "./RaffleController";
import { PrismaRaffleRepository } from "./PrismaRaffleRepository";
import {
  CreateRaffleUseCase,
  EditRaffleUseCase,
  CancelRaffleUseCase,
  DeleteRaffleUseCase,
  DrawRaffleUseCase,
  GetClientRafflesUseCase,
  GetAdminRafflesUseCase,
  GetRaffleDetailsUseCase,
  SetRaffleVisibilityUseCase,
} from "../application/RaffleUseCases";
import {
  authMiddleware,
  adminOnly,
} from "../../../shared/infrastructure/middlewares/authMiddleware";

const router = Router();

const raffleRepository = new PrismaRaffleRepository();
const createRaffleUseCase = new CreateRaffleUseCase(raffleRepository);
const editRaffleUseCase = new EditRaffleUseCase(raffleRepository);
const cancelRaffleUseCase = new CancelRaffleUseCase(raffleRepository);
const deleteRaffleUseCase = new DeleteRaffleUseCase(raffleRepository);
const drawRaffleUseCase = new DrawRaffleUseCase(raffleRepository);
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
  getClientRafflesUseCase,
  getAdminRafflesUseCase,
  getRaffleDetailsUseCase,
  setRaffleVisibilityUseCase
);

// Client Public Routes
router.get("/", (req, res) => raffleController.getClientRaffles(req, res));
router.get("/:id", (req, res) => raffleController.getRaffleDetails(req, res));

// Admin-only Routes
router.get("/admin/all", authMiddleware, adminOnly, (req, res) =>
  raffleController.getAdminRaffles(req, res)
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

export default router;
