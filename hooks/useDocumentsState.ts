import { useState } from 'react';
import type { IndividualDocument } from '../app/p2pAppTypes';

export function useDocumentsState() {
  const [documentsByIndividualId, setDocumentsByIndividualId] = useState<
    Record<string, IndividualDocument[]>
  >({});
  return { documentsByIndividualId, setDocumentsByIndividualId };
}
