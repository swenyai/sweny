// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
	site: 'https://sweny.ai',
	integrations: [
		starlight({
			title: 'SWEny',
			description: 'Autonomous engineering tools powered by Claude AI',
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/swenyai/sweny' },
			],
			editLink: {
				baseUrl: 'https://github.com/swenyai/sweny/edit/main/packages/web/',
			},
			sidebar: [
				{
					label: 'Getting Started',
					items: [
						{ label: 'Introduction', slug: 'getting-started' },
						{ label: 'Provider Architecture', slug: 'getting-started/providers' },
						{ label: 'Deploying the Agent', slug: 'getting-started/agent' },
					],
				},
				{
					label: 'Action Reference',
					items: [
						{ label: 'Inputs', slug: 'action/inputs' },
						{ label: 'Outputs', slug: 'action/outputs' },
						{ label: 'Examples', slug: 'action/examples' },
						{ label: 'Service Map', slug: 'action/service-map' },
					],
				},
				{
					label: 'Provider Reference',
					autogenerate: { directory: 'providers' },
				},
			],
		}),
	],
});
