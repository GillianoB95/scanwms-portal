import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import type { User as SupabaseUser } from '@supabase/supabase-js';

export interface Customer {
  id: string;
  name: string;
  warehouse_id: string | null;
  parent_id: string | null;
}

interface AuthContextType {
  user: SupabaseUser | null;
  customer: Customer | null;
  role: string | null;
  loading: boolean;
  profileLoaded: boolean;
  login: (email: string, password: string) => Promise<string | null>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoaded, setProfileLoaded] = useState(false);

  const fetchCustomer = async (email: string) => {
    try {
      // Step 1: Get the user's role and customer_id without nested relation
      const { data, error } = await supabase
        .from('customer_users')
        .select('role, customer_id, warehouse_id')
        .eq('email', email)
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        setRole(null);
        setCustomer(null);
        return;
      }

      setRole(data.role ?? null);

      // Step 2: Only fetch customer details if this is a customer-linked user
      if (data.customer_id && data.role === 'customer') {
        const { data: cust, error: custError } = await supabase
          .from('customers')
          .select('id, name, warehouse_id, parent_id')
          .eq('id', data.customer_id)
          .maybeSingle();

        if (custError) {
          console.error('fetchCustomer: customer lookup failed:', custError);
        }
        setCustomer(cust ? cust as unknown as Customer : null);
      } else {
        setCustomer(null);
      }
    } finally {
      setProfileLoaded(true);
    }
  };

  useEffect(() => {
    console.log('[AuthProvider] useEffect running');

    const handleCustomerFetch = (email: string) => {
      window.setTimeout(() => {
        fetchCustomer(email).catch((error) => {
          console.error('fetchCustomer failed:', error);
        });
      }, 0);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null);
        setLoading(false);
        if (session?.user?.email) {
          handleCustomerFetch(session.user.email);
        } else {
          setCustomer(null);
        }
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
      if (session?.user?.email) {
        handleCustomerFetch(session.user.email);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const login = async (email: string, password: string): Promise<string | null> => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? error.message : null;
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setCustomer(null);
    setRole(null);
  };

  return (
    <AuthContext.Provider value={{ user, customer, role, loading, profileLoaded, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
