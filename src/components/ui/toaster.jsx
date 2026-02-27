import React, { useEffect, useState } from 'react';

// Lightweight local toast implementation for small projects
export function Toaster() {
	const [toasts, setToasts] = useState([]);

	useEffect(() => {
		const handler = (e) => {
			const id = Math.random().toString(36).slice(2, 9);
			setToasts(t => [...t, { id, ...e.detail }]);
			setTimeout(() => {
				setToasts(t => t.filter(x => x.id !== id));
			}, (e.detail.ttl || 3000));
		};
		window.addEventListener('nithya-toast', handler);
		return () => window.removeEventListener('nithya-toast', handler);
	}, []);

	if (!toasts.length) return null;

	return (
		<div style={{ position: 'fixed', top: 12, right: 12, zIndex: 9999 }}>
			{toasts.map(t => (
				<div key={t.id} className="mb-2 px-3 py-2 rounded shadow-lg bg-slate-800 text-white">
					{t.text}
				</div>
			))}
		</div>
	);
}

export default Toaster;

// helper to trigger a toast: window.dispatchEvent(new CustomEvent('nithya-toast',{detail:{text:'hi'}}))
