import React from 'react';

export function Card({ children, className = '', ...props }) {
	return (
		<div className={`bg-white/5 border border-slate-800 p-4 rounded-lg shadow-sm ${className}`} {...props}>
			{children}
		</div>
	);
}

export function CardHeader({ children, className = '', ...props }) {
	return (
		<div className={`mb-2 ${className}`} {...props}>
			{children}
		</div>
	);
}

export function CardTitle({ children, className = '', ...props }) {
	return (
		<h3 className={`text-lg font-semibold ${className}`} {...props}>
			{children}
		</h3>
	);
}

export function CardDescription({ children, className = '', ...props }) {
	return (
		<p className={`text-sm text-slate-400 ${className}`} {...props}>
			{children}
		</p>
	);
}

export function CardContent({ children, className = '', ...props }) {
	return (
		<div className={className} {...props}>
			{children}
		</div>
	);
}

export default Card;
