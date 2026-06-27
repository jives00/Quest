import { useEffect, useRef } from 'react';
import { createApiController, cancelAllRequests } from './api';

export function useApiController() {
  const controllerRef = useRef<ReturnType<typeof createApiController> | null>(null);

  useEffect(() => {
    controllerRef.current = createApiController();
    return () => {
      controllerRef.current?.abort();
    };
  }, []);

  return controllerRef.current?.signal;
}

export function useApiCleanup() {
  useEffect(() => {
    return () => {
      cancelAllRequests();
    };
  }, []);
}
