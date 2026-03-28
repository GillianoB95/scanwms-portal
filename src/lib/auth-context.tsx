import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import type { User as SupabaseUser } from '@supabase/supabase-js';

interface Customer {
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

  const fetchCustomer = async (email: string) => {
    const { data } = await supabase
      .from('customer_users')
      .select('role, customer_id, customers(id, name, warehouse_id, parent_id)')
      .eq('email', email)
      .single();

    if (data) {
      setRole(data.role ?? null);
      if (data.customers) {
        const c = data.customers as unknown as Customer;
        setCustomer(c);
      }
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
    <AuthContext.Provider value={{ user, customer, role, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
