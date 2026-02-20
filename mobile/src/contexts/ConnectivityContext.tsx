import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';

interface ConnectivityContextType {
  isConnected: boolean;
  isInternetReachable: boolean | null;
  connectionType: string;
}

const ConnectivityContext = createContext<ConnectivityContextType>({
  isConnected: true,
  isInternetReachable: true,
  connectionType: 'unknown',
});

export function ConnectivityProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConnectivityContextType>({
    isConnected: true,
    isInternetReachable: true,
    connectionType: 'unknown',
  });

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((netState: NetInfoState) => {
      setState({
        isConnected: netState.isConnected ?? true,
        isInternetReachable: netState.isInternetReachable,
        connectionType: netState.type,
      });
    });

    return () => unsubscribe();
  }, []);

  return (
    <ConnectivityContext.Provider value={state}>
      {children}
    </ConnectivityContext.Provider>
  );
}

export function useConnectivity(): ConnectivityContextType {
  return useContext(ConnectivityContext);
}
