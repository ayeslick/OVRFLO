#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { selectHydratedRoute } from "../lib/router.ts";

const input = JSON.parse(readFileSync(0, "utf8"));
const result = selectHydratedRoute({
  positions: input.positions.map((position) => ({
    ...position,
    id: BigInt(position.id),
    availableLiquidity: BigInt(position.availableLiquidity),
  })),
  borrower: input.borrower,
  target: BigInt(input.target),
  aggregateDepth: BigInt(input.aggregateDepth),
  maxRouteIds: input.maxRouteIds,
});

process.stdout.write(
  JSON.stringify(result, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value,
  ),
);
