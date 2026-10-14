// One named `Material` component in the OpenAPI document, reused by printers and filaments.
import { z } from '../http/zod.js';
import { MATERIALS } from './materials.js';

export const materialSchema = z.enum(MATERIALS).openapi('Material');
