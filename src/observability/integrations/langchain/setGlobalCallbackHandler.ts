import type { BaseCallbackHandler } from '@langchain/core/callbacks/base';

let globalHandler: BaseCallbackHandler | undefined;

export const setGlobalCallbackHandler = (handler: BaseCallbackHandler) => {
  globalHandler = handler;
};

export const getGlobalHandler = (): BaseCallbackHandler | undefined => {
  return globalHandler;
};

export const clearGlobalHandler = () => {
  globalHandler = undefined;
};
