import { QueryClient } from '@tanstack/react-query';


export const queryClientInstance = new QueryClient({
	defaultOptions: {
		queries: {
			networkMode: 'offlineFirst',
			staleTime: 30 * 1000,
			gcTime: 10 * 60 * 1000,
			refetchOnMount: true,
			refetchOnReconnect: true,
			refetchOnWindowFocus: false,
			retry: 1,
		},
		mutations: {
			networkMode: 'online',
			retry: 1,
		},
	},
});
