import { createConfigResponse, type ConfigEvent } from '../../server/config';

export function handler(event: ConfigEvent) { return createConfigResponse(event, process.env); }
