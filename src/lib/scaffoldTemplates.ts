/**
 * Standardized Project Scaffold Templates
 * Codifies 9 standard repository templates for the BUILD agent and buildSandbox engine.
 */

export type ScaffoldType =
  | 'generic'
  | 'node-api'
  | 'express-users'
  | 'nextjs'
  | 'react-card'
  | 'baseline';

export interface ScaffoldFile {
  path: string;
  content: string;
  description?: string;
}

export interface ScaffoldDefinition {
  id: ScaffoldType;
  name: string;
  description: string;
  tree: string;
  files: ScaffoldFile[];
}

// ---------------------------------------------------------------------------
// 1. Generic Project Scaffold Template Tree (Infrastructure-Critical)
// ---------------------------------------------------------------------------
export const GENERIC_SCAFFOLD_TREE = `project-name/
├── .gitignore
├── .editorconfig
├── package.json or pyproject.toml or go.mod
├── tsconfig.json / pyproject.toml / Cargo.toml
├── .env.example
├── Makefile
├── docker-compose.yml
├── Dockerfile
├── scripts/
│   └── setup.sh
├── .github/
│   └── workflows/
│       └── ci.yml
└── README.md`;

// ---------------------------------------------------------------------------
// 2. .gitignore Template
// ---------------------------------------------------------------------------
export const GITIGNORE_TEMPLATE = `# Dependencies
node_modules/
.venv/
venv/
__pycache__/
*.pyc

# Environment
.env
.env.local
.env.*.local

# Build output
dist/
build/
out/
target/

# Logs
*.log
logs/

# Editor
.vscode/
.idea/
.DS_Store

# Test / coverage
coverage/
.nyc_output/
htmlcov/
.pytest_cache/
.mypy_cache/
.ruff_cache/

# Docker / runtime
docker-data/
*.db
*.sqlite
`;

// ---------------------------------------------------------------------------
// 3. .editorconfig Template
// ---------------------------------------------------------------------------
export const EDITORCONFIG_TEMPLATE = `root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true

[*.{js,jsx,ts,tsx,json,yaml,yml,md}]
indent_style = space
indent_size = 2

[*.{py}]
indent_style = space
indent_size = 4

[Makefile]
indent_style = tab

[*.md]
trim_trailing_whitespace = false
`;

// ---------------------------------------------------------------------------
// 4. README.md Template (Build Knowledge Understanding)
// ---------------------------------------------------------------------------
export const README_TEMPLATE = (projectName: string = 'Project Name') => `# ${projectName}

Infrastructure-grade repository with automated build, test, containerization, and CI pipelines.

## Build Knowledge & System Architecture

\`\`\`text
Host System / Developer Machine
  ├── 1. Setup & Config:       scripts/setup.sh  ->  .env.example -> .env
  ├── 2. Verification & Build: Makefile          ->  Lint, Typecheck, Test, Build
  ├── 3. Container Runtime:    Dockerfile        ->  Multi-stage production image
  ├── 4. Service Topology:     docker-compose.yml->  App + Database + Cache
  └── 5. Continuous Delivery:  .github/workflows ->  Automated CI pipeline
\`\`\`

## Quick Start & Verification Sequence

Execute the verified bootstrap sequence:

\`\`\`bash
# 1. Bootstrap environment and lock dependencies
bash scripts/setup.sh

# 2. Run automated test suite
make test

# 3. Compile production artifacts
make build

# 4. Launch containerized infrastructure
docker-compose up --build -d
\`\`\`

## Infrastructure & Build Knowledge Reference

| Component | File Path | Build Purpose | Key Commands |
|---|---|---|---|
| **Environment Setup** | \`scripts/setup.sh\` | Idempotent environment initialization & dependencies | \`bash scripts/setup.sh\` |
| **Task Automation** | \`Makefile\` | Standardized build & test orchestration targets | \`make test\`, \`make build\` |
| **Container Engine** | \`Dockerfile\` | Multi-stage lightweight production container | \`docker build -t app .\` |
| **Service Composition** | \`docker-compose.yml\` | Local multi-container development environment | \`docker-compose up -d\` |
| **CI/CD Pipeline** | \`.github/workflows/ci.yml\` | Continuous integration verification on push/PR | Automated GitHub Actions |
| **Environment Config** | \`.env.example\` | Baseline configuration & required secrets contract | \`cp .env.example .env\` |
| **Editor Standards** | \`.editorconfig\` | Cross-editor line endings, indentation, and formatting | Auto-enforced |
| **VCS Exclusion** | \`.gitignore\` | Prevents credential leaks and artifact clutter | Auto-enforced |

## Environment Variables Contract

| Variable | Required | Default | Description |
|---|---:|---|---|
| \`NODE_ENV\` | No | \`development\` | Runtime environment tier (\`development\`, \`test\`, \`production\`) |
| \`PORT\` | No | \`3000\` | Application HTTP listener port |
| \`DATABASE_URL\` | Yes | - | Primary database connection URI |
| \`REDIS_URL\` | No | \`redis://localhost:6379\` | Cache and pub/sub message broker |
| \`JWT_SECRET\` | Yes | - | Cryptographic token signing secret |

## Operational Runbook & Troubleshooting

| Incident / Symptom | Root Cause | Resolution |
|---|---|---|
| \`Port 3000 in use\` | Conflicting background process | Run \`lsof -ti:3000 \\| xargs kill -9\` or override \`PORT=3001\` |
| \`Database refused\` | Postgres container not yet healthy | Run \`docker-compose up -d postgres\` and verify \`DATABASE_URL\` |
| \`Missing environment\` | Missing \`.env\` file | Run \`bash scripts/setup.sh\` or \`cp .env.example .env\` |
| \`Build failed\` | Transpilation or lint error | Run \`npm run lint\` and \`npm run typecheck\` for trace |
`;

// ---------------------------------------------------------------------------
// 5. .env.example Template
// ---------------------------------------------------------------------------
export const ENV_EXAMPLE_TEMPLATE = `# App
NODE_ENV=development
PORT=3000
LOG_LEVEL=info

# Database
DATABASE_URL=postgres://user:password@localhost:5432/app
REDIS_URL=redis://localhost:6379

# Auth
JWT_SECRET=replace-me
JWT_EXPIRES_IN=1h

# External APIs
STRIPE_SECRET_KEY=
OPENAI_API_KEY=

# Feature Flags
ENABLE_BETA_FEATURES=false
`;

// ---------------------------------------------------------------------------
// 5.1 scripts/setup.sh Template
// ---------------------------------------------------------------------------
export const SETUP_SH_TEMPLATE = `#!/usr/bin/env bash
set -euo pipefail
cp -n .env.example .env || true
npm ci
echo "Setup complete"
`;

// ---------------------------------------------------------------------------
// 6. TypeScript Node API Scaffold Template
// ---------------------------------------------------------------------------
export const TS_NODE_API_PACKAGE_JSON = `{
  "name": "node-api",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js",
    "lint": "eslint src --ext .ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "helmet": "^7.1.0",
    "cors": "^2.8.5",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/node": "^20.12.12",
    "eslint": "^9.4.0",
    "tsx": "^4.11.0",
    "typescript": "^5.4.5",
    "vitest": "^1.6.0"
  }
}`;

export const TS_NODE_API_TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "dist",
    "rootDir": "src",
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}`;

export const TS_NODE_API_ENV_TS = `import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.string().default("info"),
  DATABASE_URL: z.string().optional(),
  JWT_SECRET: z.string().optional(),
});

const env = envSchema.parse(process.env);

export const config = {
  env: env.NODE_ENV,
  port: env.PORT,
  logLevel: env.LOG_LEVEL,
  databaseUrl: env.DATABASE_URL,
  jwtSecret: env.JWT_SECRET,
};

export type Config = typeof config;
`;

export const TS_NODE_API_APP_TS = `import express from "express";
import helmet from "helmet";
import cors from "cors";
import { errorHandler } from "./middleware/errorHandler.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { healthRoutes } from "./modules/health/health.routes.js";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use(requestLogger);

  app.use("/health", healthRoutes);

  app.use(errorHandler);

  return app;
}
`;

export const TS_NODE_API_SERVER_TS = `import { createApp } from "./app.js";
import { config } from "./config/env.js";

const app = createApp();

app.listen(config.port, () => {
  console.log(\`Server running on port \${config.port}\`);
});
`;

export const TS_NODE_API_ERROR_HANDLER_TS = `import type { NextFunction, Request, Response } from "express";

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: err.message,
    });
  }

  console.error(err);

  return res.status(500).json({
    error: "Internal server error",
  });
}
`;

export const TS_NODE_API_REQUEST_LOGGER_TS = `import type { NextFunction, Request, Response } from "express";

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    console.log(\`\${req.method} \${req.originalUrl} \${res.statusCode} \${duration}ms\`);
  });

  next();
}
`;

export const TS_NODE_API_HEALTH_CONTROLLER_TS = `import type { Request, Response } from "express";

export function healthHandler(_req: Request, res: Response) {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
}
`;

export const TS_NODE_API_HEALTH_ROUTES_TS = `import { Router } from "express";
import { healthHandler } from "./health.controller.js";

export const healthRoutes = Router();

healthRoutes.get("/", healthHandler);
`;

export const TS_NODE_API_VITEST_CONFIG = `import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"],
  },
});
`;

// ---------------------------------------------------------------------------
// 7. Express Route + Controller + Service Template
// ---------------------------------------------------------------------------
export const EXPRESS_USERS_ROUTES_TS = `import { Router } from "express";
import { listUsers, createUser } from "./users.controller.js";

export const usersRoutes = Router();

usersRoutes.get("/", listUsers);
usersRoutes.post("/", createUser);
`;

export const EXPRESS_USERS_CONTROLLER_TS = `import type { Request, Response } from "express";
import { userService } from "./users.service.js";

export async function listUsers(_req: Request, res: Response) {
  const users = await userService.list();
  res.json(users);
}

export async function createUser(req: Request, res: Response) {
  const user = await userService.create(req.body);
  res.status(201).json(user);
}
`;

export const EXPRESS_USERS_SERVICE_TS = `import { AppError } from "../../middleware/errorHandler.js";

type UserInput = {
  name: string;
  email: string;
};

export const userService = {
  async list() {
    return [
      { id: "1", name: "Alice", email: "alice@example.com" },
    ];
  },

  async create(input: UserInput) {
    if (!input.name) {
      throw new AppError(400, "name is required");
    }

    return {
      id: crypto.randomUUID(),
      name: input.name,
      email: input.email,
    };
  },
};
`;

// ---------------------------------------------------------------------------
// 8. Next.js App Scaffold Template
// ---------------------------------------------------------------------------
export const NEXTJS_PACKAGE_JSON = `{
  "name": "next-app",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "next": "^14.2.3",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^20.12.12",
    "@types/react": "^18.3.2",
    "@types/react-dom": "^18.3.0",
    "eslint": "^9.4.0",
    "eslint-config-next": "^14.2.3",
    "typescript": "^5.4.5",
    "vitest": "^1.6.0"
  }
}`;

export const NEXTJS_LAYOUT_TSX = `import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "App",
  description: "Next.js application scaffold",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`;

export const NEXTJS_PAGE_TSX = `export default function Home() {
  return (
    <main style={{ padding: 24 }}>
      <h1>Next.js App</h1>
      <p>Starter template ready.</p>
    </main>
  );
}
`;

export const NEXTJS_HEALTH_ROUTE_TS = `import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
}
`;

export const NEXTJS_UTILS_TS = `export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}
`;

export const NEXTJS_CONFIG_MJS = `/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
`;

// ---------------------------------------------------------------------------
// 9. React Component Scaffold Template
// ---------------------------------------------------------------------------
export const REACT_CARD_COMPONENT_TSX = `type Props = {
  title: string;
  description?: string;
  onClick?: () => void;
};

export function Card({ title, description, onClick }: Props) {
  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        padding: 16,
        maxWidth: 400,
      }}
      onClick={onClick}
    >
      <h3 style={{ margin: "0 0 8px 0" }}>{title}</h3>
      {description && <p style={{ margin: 0, color: "#6b7280" }}>{description}</p>}
    </div>
  );
}
`;

// ---------------------------------------------------------------------------
// Helper Collections & Scaffolding Generators
// ---------------------------------------------------------------------------

export function getStandardBaselineFiles(projectName: string = 'project-name'): ScaffoldFile[] {
  return [
    { path: '.gitignore', content: GITIGNORE_TEMPLATE, description: 'Universal gitignore' },
    { path: '.editorconfig', content: EDITORCONFIG_TEMPLATE, description: 'Standardized editorconfig' },
    { path: 'README.md', content: README_TEMPLATE(projectName), description: 'Structured documentation template' },
    { path: '.env.example', content: ENV_EXAMPLE_TEMPLATE, description: 'Baseline environment variables' },
  ];
}

export function getNodeApiScaffoldFiles(projectName: string = 'node-api'): ScaffoldFile[] {
  const baseline = getStandardBaselineFiles(projectName);
  const apiFiles: ScaffoldFile[] = [
    { path: 'package.json', content: TS_NODE_API_PACKAGE_JSON, description: 'Express + TS package.json' },
    { path: 'tsconfig.json', content: TS_NODE_API_TSCONFIG, description: 'TypeScript configuration' },
    { path: 'vitest.config.ts', content: TS_NODE_API_VITEST_CONFIG, description: 'Vitest test configuration' },
    { path: 'src/config/env.ts', content: TS_NODE_API_ENV_TS, description: 'Zod-validated environment config' },
    { path: 'src/app.ts', content: TS_NODE_API_APP_TS, description: 'Express app factory' },
    { path: 'src/server.ts', content: TS_NODE_API_SERVER_TS, description: 'Server entrypoint' },
    { path: 'src/middleware/errorHandler.ts', content: TS_NODE_API_ERROR_HANDLER_TS, description: 'AppError middleware' },
    { path: 'src/middleware/requestLogger.ts', content: TS_NODE_API_REQUEST_LOGGER_TS, description: 'HTTP request logger' },
    { path: 'src/modules/health/health.controller.ts', content: TS_NODE_API_HEALTH_CONTROLLER_TS, description: 'Health controller' },
    { path: 'src/modules/health/health.routes.ts', content: TS_NODE_API_HEALTH_ROUTES_TS, description: 'Health router' },
    { path: 'src/types/index.ts', content: '// Export shared application types\n', description: 'Types index' },
  ];
  return [...baseline, ...apiFiles];
}

export function getNextJsScaffoldFiles(projectName: string = 'next-app'): ScaffoldFile[] {
  const baseline = getStandardBaselineFiles(projectName);
  const nextFiles: ScaffoldFile[] = [
    { path: 'package.json', content: NEXTJS_PACKAGE_JSON, description: 'Next.js 14 package.json' },
    { path: 'next.config.mjs', content: NEXTJS_CONFIG_MJS, description: 'Next.js configuration' },
    { path: 'src/app/layout.tsx', content: NEXTJS_LAYOUT_TSX, description: 'Root layout' },
    { path: 'src/app/page.tsx', content: NEXTJS_PAGE_TSX, description: 'Home page' },
    { path: 'src/app/globals.css', content: '/* Global application styles */\nbody { margin: 0; font-family: sans-serif; }\n', description: 'Global CSS' },
    { path: 'src/app/api/health/route.ts', content: NEXTJS_HEALTH_ROUTE_TS, description: 'Health API route' },
    { path: 'src/lib/utils.ts', content: NEXTJS_UTILS_TS, description: 'Classnames helper (cn)' },
    { path: 'src/types/index.ts', content: '// Export shared application types\n', description: 'Types index' },
  ];
  return [...baseline, ...nextFiles];
}

export function getExpressUsersFiles(): ScaffoldFile[] {
  return [
    { path: 'src/modules/users/users.routes.ts', content: EXPRESS_USERS_ROUTES_TS, description: 'Express users router' },
    { path: 'src/modules/users/users.controller.ts', content: EXPRESS_USERS_CONTROLLER_TS, description: 'Users controller' },
    { path: 'src/modules/users/users.service.ts', content: EXPRESS_USERS_SERVICE_TS, description: 'Users service' },
  ];
}

export function getReactCardFiles(): ScaffoldFile[] {
  return [
    { path: 'src/components/ui/Card.tsx', content: REACT_CARD_COMPONENT_TSX, description: 'React Card component' },
  ];
}

export function getGenericScaffoldFiles(projectName: string = 'project-name'): ScaffoldFile[] {
  // 1. Foundational infrastructure files written first
  const infraFiles: ScaffoldFile[] = [
    { path: '.gitignore', content: GITIGNORE_TEMPLATE, description: 'Universal gitignore' },
    { path: '.editorconfig', content: EDITORCONFIG_TEMPLATE, description: 'Standardized editorconfig' },
    { path: '.env.example', content: ENV_EXAMPLE_TEMPLATE, description: 'Baseline environment variables' },
    { path: 'Makefile', content: '.PHONY: all test build clean\n\nall: test build\n\ntest:\n\tnpm test\n\nbuild:\n\tnpm run build\n', description: 'Standard Makefile' },
    { path: 'docker-compose.yml', content: 'version: "3.8"\nservices:\n  app:\n    build: .\n    ports:\n      - "3000:3000"\n', description: 'Docker Compose spec' },
    { path: 'Dockerfile', content: 'FROM node:20-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm install\nCOPY . .\nEXPOSE 3000\nCMD ["npm", "start"]\n', description: 'Containerfile' },
    { path: 'scripts/setup.sh', content: SETUP_SH_TEMPLATE, description: 'Environment setup script' },
    { path: '.github/workflows/ci.yml', content: 'name: CI\non: [push, pull_request]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: npm install && npm test\n', description: 'CI workflow' },
  ];

  // 2. Add README to the tree after sufficient files written for build knowledge understanding
  const buildKnowledgeReadme: ScaffoldFile = {
    path: 'README.md',
    content: README_TEMPLATE(projectName),
    description: 'Synthesized build knowledge, architecture, and verification runbook',
  };

  return [...infraFiles, buildKnowledgeReadme];
}

/**
 * Ensures a README.md with build knowledge understanding is added to the tree
 * after sufficient files (>= 3) have been written.
 */
export function addReadmeAfterSufficientFiles(
  files: ScaffoldFile[],
  projectName: string = 'project-name'
): ScaffoldFile[] {
  const hasReadme = files.some((f) => f.path.toLowerCase() === 'readme.md');
  if (hasReadme) return files;

  if (files.length >= 3) {
    return [
      ...files,
      {
        path: 'README.md',
        content: README_TEMPLATE(projectName),
        description: 'Synthesized build knowledge, architecture, and verification runbook',
      },
    ];
  }

  return files;
}

/**
 * Retrieve scaffold files by type
 */
export function getScaffoldFiles(
  type: ScaffoldType,
  options?: { projectName?: string }
): ScaffoldFile[] {
  const name = options?.projectName || 'project-name';
  switch (type) {
    case 'baseline':
      return getStandardBaselineFiles(name);
    case 'node-api':
      return getNodeApiScaffoldFiles(name);
    case 'nextjs':
      return getNextJsScaffoldFiles(name);
    case 'express-users':
      return getExpressUsersFiles();
    case 'react-card':
      return getReactCardFiles();
    case 'generic':
    default:
      return getGenericScaffoldFiles(name);
  }
}

/**
 * Automatically detects recommended scaffold type from a task goal or prompt
 */
export function detectScaffoldType(goalOrQuery: string): ScaffoldType | null {
  const text = (goalOrQuery || '').toLowerCase();
  if (/\b(next(\.?js)?|react\s+app|app\s+router)\b/i.test(text)) {
    return 'nextjs';
  }
  if (/\b(node\s*api|express(\s*api)?|rest\s*api|backend\s*api|ts\s*api)\b/i.test(text)) {
    return 'node-api';
  }
  if (/\b(user\s*route|user\s*service|controller\s*service)\b/i.test(text)) {
    return 'express-users';
  }
  if (/\b(card\s*component|react\s*component|ui\s*component)\b/i.test(text)) {
    return 'react-card';
  }
  if (/\b(gitignore|editorconfig|readme|env\.example|baseline)\b/i.test(text)) {
    return 'baseline';
  }
  if (/\b(scaffold|bootstrap|from\s+scratch|new\s+project|init(iali[sz]e)?|template)\b/i.test(text)) {
    return 'generic';
  }
  return null;
}

/**
 * Formats a clean markdown section detailing the scaffold template for build plans
 */
export function formatScaffoldPlanSection(type: ScaffoldType, projectName: string = 'app'): string {
  const files = getScaffoldFiles(type, { projectName });
  const fileLines = files.map((f) => `- \`${f.path}\`: ${f.description || 'Scaffold file'}`).join('\n');
  return `### Standard Project Scaffold (${type})

\`\`\`text
${type === 'node-api' ? `src/
├── app.ts
├── server.ts
├── config/env.ts
├── middleware/
│   ├── errorHandler.ts
│   └── requestLogger.ts
├── modules/health/
│   ├── health.controller.ts
│   └── health.routes.ts
├── utils/
└── types/` : type === 'nextjs' ? `src/
├── app/
│   ├── layout.tsx
│   ├── page.tsx
│   ├── globals.css
│   └── api/health/route.ts
├── components/
├── lib/utils.ts
└── types/` : GENERIC_SCAFFOLD_TREE}
\`\`\`

**Files to scaffold:**
${fileLines}`;
}
