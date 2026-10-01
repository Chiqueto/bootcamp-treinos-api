import { execSync } from "node:child_process";
import fs from "node:fs";

import fastifySwagger from "@fastify/swagger";
import Fastify from "fastify";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";

import { aiRoutes } from "../routes/ai.js";
import { exerciseRoutes } from "../routes/exercise.js";
import { historyRoutes } from "../routes/history.js";
import { homeRoutes } from "../routes/home.js";
import { meRoutes } from "../routes/me.js";
import { periodizationRoutes } from "../routes/periodization.js";
import { planningRoutes } from "../routes/planning.js";
import { statsRoutes } from "../routes/stats.js";
import { WorkoutPlanRoutes } from "../routes/workout-plan.js";
import { workoutSessionRoutes } from "../routes/workout-session.js";

const app = Fastify();
app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);

await app.register(fastifySwagger, {
  openapi: {
    info: {
      title: "Bootcamp Treinos API",
      description: "Sample backend service",
      version: "1.0.0",
    },
    servers: [
      {
        description: "API Base Url",
        url: "http://localhost:8080",
      },
    ],
  },
  transform: jsonSchemaTransform,
});

await app.register(WorkoutPlanRoutes, { prefix: "/workout-plans" });
await app.register(periodizationRoutes, { prefix: "/periodizations" });
await app.register(planningRoutes, { prefix: "/planning" });
await app.register(homeRoutes, { prefix: "/home" });
await app.register(statsRoutes, { prefix: "/stats" });
await app.register(meRoutes, { prefix: "/me" });
await app.register(aiRoutes, { prefix: "/ai" });
await app.register(exerciseRoutes, { prefix: "/exercises" });
await app.register(workoutSessionRoutes);
await app.register(historyRoutes, { prefix: "/history" });

await app.ready();
const swaggerSpec = app.swagger();

const frontendSwaggerPath = "c:/Users/luis-chiqueto/Documents/Proj/treinos/bootcamp-treinos-frontend/swagger.json";
fs.writeFileSync(frontendSwaggerPath, JSON.stringify(swaggerSpec, null, 2), "utf8");
console.log(`Updated swagger.json at: ${frontendSwaggerPath}`);

console.log("Running npx orval in frontend directory...");
execSync("npx orval", {
  cwd: "c:/Users/luis-chiqueto/Documents/Proj/treinos/bootcamp-treinos-frontend",
  stdio: "inherit",
});
console.log("Orval successfully generated typed client!");
process.exit(0);
