// Zod with OpenAPI metadata support. Import `z` from here in every *.schemas.ts file so that
// schemas can be named in the generated contract with `.openapi('Name')`.
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

export { z };
