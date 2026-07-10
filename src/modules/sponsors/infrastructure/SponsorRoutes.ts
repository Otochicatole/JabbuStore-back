import { Router } from "express";
import { authMiddleware, adminOnly } from "../../../shared/infrastructure/middlewares/authMiddleware";
import { validate } from "../../../shared/infrastructure/middlewares/validationMiddleware";
import {
  AdminListSponsorsUseCase,
  CreateSponsorUseCase,
  DeleteSponsorUseCase,
  GetSponsorImageUseCase,
  ListPublicSponsorsUseCase,
  ReorderSponsorsUseCase,
  UpdateSponsorUseCase,
} from "../application/SponsorUseCases";
import { PrismaSponsorRepository } from "./PrismaSponsorRepository";
import { SponsorController } from "./SponsorController";
import { uploadSponsorImage } from "./SponsorImageStorage";
import {
  createSponsorSchema,
  reorderSponsorsSchema,
  sponsorIdParamsSchema,
  updateSponsorSchema,
} from "./sponsorSchemas";

const router = Router();

const sponsorRepository = new PrismaSponsorRepository();
const sponsorController = new SponsorController(
  new ListPublicSponsorsUseCase(sponsorRepository),
  new AdminListSponsorsUseCase(sponsorRepository),
  new GetSponsorImageUseCase(sponsorRepository),
  new CreateSponsorUseCase(sponsorRepository),
  new UpdateSponsorUseCase(sponsorRepository),
  new DeleteSponsorUseCase(sponsorRepository),
  new ReorderSponsorsUseCase(sponsorRepository),
);

router.get("/public", (req, res) => sponsorController.listPublic(req, res));
router.get("/:id/image/:version", validate(sponsorIdParamsSchema), (req, res) => sponsorController.image(req, res));
router.get("/:id/image", validate(sponsorIdParamsSchema), (req, res) => sponsorController.image(req, res));

router.get("/admin", authMiddleware, adminOnly, (req, res) => sponsorController.adminList(req, res));
router.post(
  "/admin",
  authMiddleware,
  adminOnly,
  uploadSponsorImage.single("image"),
  validate(createSponsorSchema),
  (req, res) => sponsorController.create(req, res),
);
router.patch(
  "/admin/reorder",
  authMiddleware,
  adminOnly,
  validate(reorderSponsorsSchema),
  (req, res) => sponsorController.reorder(req, res),
);
router.patch(
  "/admin/:id",
  authMiddleware,
  adminOnly,
  uploadSponsorImage.single("image"),
  validate(updateSponsorSchema),
  (req, res) => sponsorController.update(req, res),
);
router.delete(
  "/admin/:id",
  authMiddleware,
  adminOnly,
  validate(sponsorIdParamsSchema),
  (req, res) => sponsorController.delete(req, res),
);

export default router;
