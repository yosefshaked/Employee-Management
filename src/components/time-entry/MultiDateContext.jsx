/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState } from 'react';

const MultiDateContext = createContext({
  isMultiDateMode: false,
  setIsMultiDateMode: () => {},
  lastRows: [],
  setLastRows: () => {},
});

export const MultiDateProvider = ({ children }) => {
  const [isMultiDateMode, setIsMultiDateMode] = useState(false);
  const [lastRows, setLastRows] = useState([]);
  return (
    <MultiDateContext.Provider value={{ isMultiDateMode, setIsMultiDateMode, lastRows, setLastRows }}>
      {children}
    </MultiDateContext.Provider>
  );
};

export const useMultiDate = () => useContext(MultiDateContext);
