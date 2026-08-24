import { Router, type IRouter } from "express";
import healthRouter from "./health";
import deflectionRouter from "./deflection";

const router: IRouter = Router();

router.use(healthRouter);
router.use(deflectionRouter);

export default router;
