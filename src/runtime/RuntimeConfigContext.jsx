import React, { createContext, useContext } from 'react';

const RuntimeConfigContext = createContext(null);

export function RuntimeConfigProvider({ config, children }) {
  return (
    <RuntimeConfigContext.Provider value={config}>
      {children}
    </RuntimeConfigContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useRuntimeConfig() {
  const context = useContext(RuntimeConfigContext);
  if (!context) {
    throw new Error('RuntimeConfigProvider is missing from the component tree');
  }
  return context;
}
