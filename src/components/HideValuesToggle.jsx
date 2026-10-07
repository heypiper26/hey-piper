import { Eye, EyeOff } from 'lucide-react';
import { useHideValues } from '../hooks/useHideValues.js';

export default function HideValuesToggle() {
  const { hidden, toggle } = useHideValues();

  return (
    <button
      onClick={toggle}
      className="btn-ghost p-1.5 text-gray-500 hover:text-gray-300"
      title={hidden ? 'Mostrar valores' : 'Ocultar valores'}
    >
      {hidden ? <EyeOff size={18} /> : <Eye size={18} />}
    </button>
  );
}
