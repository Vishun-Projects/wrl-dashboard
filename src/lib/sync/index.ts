/**
 * Sync proxy — authenticated CRM table streaming for read-model sync.
 */

export { authorizeSyncProxy } from './proxy-auth';
export {
  ESSENTIAL_SYNC_TABLES,
  handleSyncProxyGet,
  syncProxyOptions,
} from './proxy-route';
