import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { clearCardReturn, loadCardReturn } from '../lib/storage';

/**
 * Where Pesapal sends the diner after the hosted-checkout page (the configured
 * PESAPAL_CALLBACK_URL path). Confirmation is server-side via the IPN, so this
 * page just bounces back to the diner's session, where polling + sockets show
 * the order moving to the kitchen.
 */
export function CardReturnPage() {
  const navigate = useNavigate();
  useEffect(() => {
    const sessionId = loadCardReturn();
    clearCardReturn();
    const t = setTimeout(() => navigate(sessionId ? `/session/${sessionId}` : '/'), 1500);
    return () => clearTimeout(t);
  }, [navigate]);

  return (
    <div className="mx-auto max-w-md p-8 text-center">
      <h1 className="text-xl font-bold text-teal-700">Thanks!</h1>
      <p className="mt-3 text-slate-600">
        Confirming your payment and taking you back to your order…
      </p>
    </div>
  );
}
