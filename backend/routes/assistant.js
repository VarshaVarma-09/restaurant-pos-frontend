import { Router } from 'express';
import { authenticate, allow } from '../middleware/auth.js';
import { createAssistantController } from '../controllers/assistantController.js';

export function createAssistantRouter(options) {
  const router = Router();
  router.post('/chat', authenticate, allow('assistant:use'), createAssistantController(options));
  return router;
}

export default createAssistantRouter();
