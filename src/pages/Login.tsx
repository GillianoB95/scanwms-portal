import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { Package, Loader2 } from 'lucide-react';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    const err = await login(email, password);
    if (err) {
      setError(err);
      setSubmitting(false);
      return;
    }

    // Fetch role to determine redirect
    const { data } = await supabase
      .from('customer_users')
      .select('role')
      .eq('email', email)
      .maybeSingle();

    const role = data?.role;
    if (role === 'staff' || role === 'admin') {
      navigate('/staff', { replace: true });
    } else if (role === 'warehouse') {
      navigate('/warehouse', { replace: true });
    } else {
      navigate('/dashboard', { replace: true });
    }
    setSubmitting(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm animate-fade-in">
        <div className="bg-card rounded-xl shadow-lg border p-8">
          <div className="flex flex-col items-center mb-8">
            <div className="h-12 w-12 rounded-xl bg-primary flex items-center justify-center mb-4">
              <Package className="h-6 w-6 text-primary-foreground" />
            </div>
            <h1 className="text-xl font-bold">
              <span className="text-accent">SCAN</span>
              <span className="text-foreground">WMS</span>
            </h1>
            <p className="text-muted-foreground text-sm mt-1">Customer Portal</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">{error}</div>
            )}
            <div>
              <label className="block text-sm font-medium mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="you@company.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full h-10 rounded-lg bg-accent text-accent-foreground text-sm font-semibold hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-60"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : 'Sign in'}
            </button>
          </form>

          <p className="text-center mt-4">
            <button className="text-sm text-accent hover:underline">Forgot password?</button>
          </p>
        </div>
      </div>
    </div>
  );
}
