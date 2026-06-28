const globalCancellationState = globalThis as typeof globalThis & {
  __telegramDownloadTaskCancellation?: {
    controllersByTaskId: Map<string, Set<AbortController>>;
  };
};

const cancellationState =
  globalCancellationState.__telegramDownloadTaskCancellation ??
  (globalCancellationState.__telegramDownloadTaskCancellation = {
    controllersByTaskId: new Map<string, Set<AbortController>>(),
  });

export function registerTaskCancellation(taskExternalId: string, controller: AbortController) {
  const controllers = cancellationState.controllersByTaskId.get(taskExternalId) ?? new Set<AbortController>();
  controllers.add(controller);
  cancellationState.controllersByTaskId.set(taskExternalId, controllers);

  return () => {
    controllers.delete(controller);
    if (controllers.size === 0) {
      cancellationState.controllersByTaskId.delete(taskExternalId);
    }
  };
}

export function abortTaskTransmissions(taskExternalId?: string) {
  const entries = taskExternalId
    ? [[taskExternalId, cancellationState.controllersByTaskId.get(taskExternalId)] as const]
    : Array.from(cancellationState.controllersByTaskId.entries());
  let aborted = 0;

  for (const [, controllers] of entries) {
    if (!controllers) {
      continue;
    }
    for (const controller of controllers) {
      if (!controller.signal.aborted) {
        controller.abort(new Error("stopped by command"));
        aborted += 1;
      }
    }
  }

  return aborted;
}

export function isTaskAbortError(error: unknown) {
  if (error instanceof Error) {
    return error.name === "AbortError" || error.message === "stopped by command";
  }
  return false;
}
