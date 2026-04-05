/**
 * Point d’entrée P2P côté hooks : modes bundle/progressif + types pour la fabrique d’envois réseau.
 * La fabrique {@link createP2PSyncSenders} vit dans `app/p2pSyncSenders.ts` et est instanciée dans `App` avec les refs.
 */
export { useP2PTransferModes } from './useP2PTransferModes';
export {
  createP2PSyncSenders,
  type P2PSyncSendersContext,
  type P2PSyncSendersLog,
} from '../app/p2pSyncSenders';
