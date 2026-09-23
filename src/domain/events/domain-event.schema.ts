import { z } from "zod";

import { eventTypeSchema } from "./event-types";
import { reasonCodeSchema } from "./reason-codes";
import { uuidSchema } from "../shared/ids";

export const domainEventSchema = z.object({
  eventId: uuidSchema,
  eventType: eventTypeSchema,
  aggregateType: z.string().min(1),
  aggregateId: uuidSchema,
  essayRevisionId: uuidSchema.optional(),
  segmentId: uuidSchema.optional(),
  taskContextVersionId: uuidSchema.optional(),
  textHash: z.string().min(1).optional(),
  dependencyHash: z.string().min(1).optional(),
  occurredAt: z.iso.datetime(),
  correlationId: uuidSchema,
  causationId: uuidSchema,
  idempotencyKey: z.string().min(1),
  reasonCode: reasonCodeSchema,
  payloadVersion: z.literal(1),
  payload: z.record(z.string(), z.unknown()),
});

export type DomainEvent = z.infer<typeof domainEventSchema>;
