import React from 'react';

export function Button({ children, className = '', variant = 'primary', ...props }) {
	const base = 'px-3 py-2 rounded-md font-medium inline-flex items-center gap-2';
	const variants = {
		primary: 'bg-sky-500 text-white hover:bg-sky-600',
		ghost: 'bg-transparent text-slate-700 hover:bg-slate-100',
	};
	return (
		<button className={`${base} ${variants[variant] ?? ''} ${className}`} {...props}>
			{children}
		</button>
	);
}

export default Button;
