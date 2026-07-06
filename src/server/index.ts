import { buildApp } from "./app.js";
import { createRuntimeOptions } from "./runtime.js";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

const app = buildApp(createRuntimeOptions());

await app.listen({ port, host });
