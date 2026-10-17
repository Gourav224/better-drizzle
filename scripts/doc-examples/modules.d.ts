// Third-party packages the docs import but this repo does not install.
declare module '@opentelemetry/api' {
	export type Span = any;
	export const SpanStatusCode: any;
	export const context: any;
	export const trace: any;
}
declare module 'better-sqlite3';
declare module 'express' {
	namespace express {
		type NextFunction = any;
		type Request = any;
		type Response = any;
	}
	function express(...args: any[]): any;
	export = express;
}
declare module 'fastify' {
	export interface FastifyRequest {
		[key: string]: any;
	}
	export interface FastifyInstance {
		[key: string]: <T = any>(...args: any[]) => any;
	}
	export default function Fastify(...args: any[]): FastifyInstance;
}
declare module 'hono' {
	export type Context = any;
	export class Hono<Env = any> {
		[key: string]: any;
		constructor(...args: any[]);
	}
}
declare module 'ioredis';
declare module 'next/headers';
