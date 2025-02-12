import { useState, useEffect, useCallback } from 'react';
import { authService } from '@/services/auth.service';
import { APP_CONFIG } from '@/config/app.config';
import { ACCOUNT_SWITCH_TRANSITION_DELAY } from '@/constants/ui';
import websocketService from '@/services/websocket.service';

export const useAuth = () => {
  const [user, setUser] = useState(null);
  const [defaultAccount, setDefaultAccount] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSwitchingAccount, setIsSwitchingAccount] = useState(false);

  // Custom event for account changes
  const ACCOUNT_CHANGE_EVENT = 'accountChange';
  const emitAccountChange = (account) => {
    const event = new CustomEvent(ACCOUNT_CHANGE_EVENT, { detail: account });
    window.dispatchEvent(event);
  };

  // Listen for WebSocket auth errors
  useEffect(() => {
    const handleError = (error) => {
      if (error.code === 'AuthorizationRequired' || error.code === 'InvalidToken') {
        setIsAuthenticated(false);
        authService.clearSession();
      }
    };

    const ws = websocketService.instance;
    
    // Subscribe to WebSocket errors
    ws.on('error', handleError);

    return () => {
      ws.off('error', handleError);
    };
  }, []);

  const switchAccount = useCallback(async (account) => {
    try {
      setIsSwitchingAccount(true);
      
      // Create new session data for the account
      const sessionData = {
        accountId: account.account,
        token: account.token,
        currency: account.currency,
        loginTime: Date.now()
      };
      
      // Update session first
      const sessionSuccess = await authService.setSession(sessionData);
      if (!sessionSuccess) {
        console.error('Failed to update session for new account');
        return false;
      }
      
      // Then update default account which will handle WebSocket authorization
      const success = await authService.setDefaultAccount(account);
      if (!success) {
        console.error('Failed to set default account');
        return false;
      }
      
      // Reload and update trading accounts to ensure consistency
      const accounts = await authService.getTradingAccounts();
      if (!accounts || !await authService.setTradingAccounts(accounts)) {
        console.error('Failed to update trading accounts');
        return false;
      }
      
      // Update all state after successful switch
      setUser(sessionData);
      setDefaultAccount(account);
      setIsAuthenticated(true);
      
      // Notify other components only after successful switch
      emitAccountChange(account);
      return true;
    } catch (error) {
      console.error('Failed to switch account:', error);
      await authService.clearSession();
      setUser(null);
      setDefaultAccount(null);
      setIsAuthenticated(false);
      return false;
    } finally {
      setTimeout(() => {
        setIsSwitchingAccount(false);
      }, ACCOUNT_SWITCH_TRANSITION_DELAY);
    }
  }, []);

  const initialize = useCallback(async () => {
    try {
      setIsLoading(true);
      console.log('Starting auth initialization');

      const isInitialized = await authService.initialize();
      console.log('Auth initialization result:', isInitialized);
      
      if (isInitialized) {
        // Get all required data before any state updates
        console.log('Fetching session and account data');
        const [session, account] = await Promise.all([
          authService.getStoredSession(),
          authService.getDefaultAccount()
        ]);
        
        // Check auth synchronously
        const isAuth = authService.isAuthenticated();
        
        console.log('Auth initialized:', {
          session,
          account,
          accountId: account?.account || '',
          isAuth
        });
        
        // Batch state updates
        setUser(session);
        setDefaultAccount(account);
        setIsAuthenticated(isAuth);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Auth initialization failed:', error);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []); // Empty dependency array to ensure stable reference

  const login = useCallback(async (telegramUser, oauthData) => {
    try {
      setIsLoading(true);
      let success = false;
      
      if (telegramUser) {
        const defaultAccount = {
          account: `TG${telegramUser.id}`,
          token: 'telegram-token',
          currency: 'USD',
          balance: '0.00'
        };
        
        // Set session and accounts first
        success = await authService.setSession(telegramUser) &&
                 await authService.setTradingAccounts([defaultAccount]);
        
        if (success) {
          // Then set default account which will handle WebSocket authorization
          success = await authService.setDefaultAccount(defaultAccount);
        }
      } else if (oauthData?.tradingAccounts?.length > 0) {
        const defaultAccount = oauthData.tradingAccounts[0];
        const sessionData = {
          accountId: defaultAccount.account,
          token: defaultAccount.token,
          currency: defaultAccount.currency,
          loginTime: Date.now()
        };
        
        // Set session and accounts first
        success = await authService.setSession(sessionData) &&
                 await authService.setTradingAccounts(oauthData.tradingAccounts);
        
        if (success) {
          // Then set default account which will handle WebSocket authorization
          success = await authService.setDefaultAccount(defaultAccount);
        }
      } else if (APP_CONFIG.environment.isDevelopment) {
        success = await authService.createTestSession();
      }
      
      if (success) {
        // Get all required data before any state updates
        const [session, account, isAuth] = await Promise.all([
          authService.getStoredSession(),
          authService.getDefaultAccount(),
          authService.isAuthenticated()
        ]);
        
        // Batch state updates
        setUser(session);
        setDefaultAccount(account);
        setIsAuthenticated(isAuth);
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('Login failed:', error);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleOAuthCallback = useCallback(async (searchParams) => {
    try {
      console.log('Processing OAuth callback params...');
      const tradingAccounts = [];
      let index = 1;
      
      // Extract all trading accounts from URL params
      while (true) {
        const account = searchParams.get(`acct${index}`);
        const token = searchParams.get(`token${index}`);
        const currency = searchParams.get(`cur${index}`);
        const balance = searchParams.get(`bal${index}`);
        
        if (!account || !token || !currency) break;
        
        tradingAccounts.push({ 
          account, 
          token, 
          currency,
          balance: balance || '0.00'
        });
        index++;
      }

      console.log(`Found ${tradingAccounts.length} trading accounts`);

      if (tradingAccounts.length > 0) {
        // Create session data from first trading account
        const defaultAccount = tradingAccounts[0];
        const sessionData = {
          accountId: defaultAccount.account,
          token: defaultAccount.token,
          currency: defaultAccount.currency,
          loginTime: Date.now()
        };

        console.log('Setting up session with data:', {
          accountId: sessionData.accountId,
          currency: sessionData.currency
        });

        // Store session
        const sessionSuccess = await authService.setSession(sessionData);
        if (!sessionSuccess) {
          console.error('Failed to store session data');
          return false;
        }

        // Store trading accounts
        const accountsSuccess = await authService.setTradingAccounts(tradingAccounts);
        if (!accountsSuccess) {
          console.error('Failed to store trading accounts');
          await authService.clearSession();
          return false;
        }

        // Set default account (which will handle WebSocket authorization)
        const defaultSuccess = await authService.setDefaultAccount(defaultAccount);
        if (!defaultSuccess) {
          console.error('Failed to set default account');
          await authService.clearSession();
          return false;
        }

        console.log('OAuth setup completed successfully');
        console.log('Successfully stored all auth data');

        // Return a promise that resolves when state is actually updated
        return new Promise(resolve => {
          // Batch state updates
          setUser(sessionData);
          setDefaultAccount(defaultAccount);
          setIsAuthenticated(true);
          
          // Use effect cleanup to ensure state is updated
          const cleanup = () => {
            console.log('Local state updated, auth status:', { 
              hasUser: Boolean(sessionData),
              hasDefaultAccount: Boolean(defaultAccount),
              isAuthenticated: true
            });
            resolve(true);
          };
          
          // Check state updates every 50ms for up to 2 seconds
          let attempts = 0;
          const maxAttempts = 40; // 2 seconds total
          
          const checkState = () => {
            if (attempts >= maxAttempts) {
              console.error('Timed out waiting for auth state update');
              cleanup();
              return;
            }
            
            // Get latest auth state
            const isAuth = authService.isAuthenticated();
            if (isAuth) {
              cleanup();
              return;
            }
            
            attempts++;
            setTimeout(checkState, 50);
          };
          
          checkState();
        });
      }
      
      console.error('No trading accounts found in OAuth callback');
      return false;
    } catch (error) {
      console.error('OAuth callback failed:', error);
      return false;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      setIsLoading(true);
      
      // Clear session - this will handle navigation
      const success = await authService.clearSession();
      
      if (success) {
        // Reset all auth state
        setUser(null);
        setDefaultAccount(null);
        setIsAuthenticated(false);
      }
      
      return success;
    } catch (error) {
      console.error('Logout failed:', error);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    initialize();
  }, [initialize]);

  // Log the state before returning
  console.log('useAuth state:', { 
    user, 
    defaultAccount,
    accountId: defaultAccount?.account || '',
    balance: defaultAccount?.balance || '0.00',
    currency: defaultAccount?.currency || 'USD',
    isAuthenticated,
    isLoading 
  });

  return {
    user,
    defaultAccount,
    accountId: defaultAccount?.account || '',
    balance: defaultAccount?.balance || '0.00',
    currency: defaultAccount?.currency || 'USD',
    isAuthenticated,
    isLoading,
    isSwitchingAccount,
    login,
    logout,
    initialize,
    handleOAuthCallback,
    switchAccount,
    ACCOUNT_CHANGE_EVENT
  };
};
