export const rateLimitedMessage='Demasiados intentos. Espera un momento antes de volver a intentarlo.';

export class RateLimited extends Error {
 constructor(response){
  super(rateLimitedMessage);
  const seconds=response.headers.get('Retry-After')??'';
  this.retryAfterMs=/^[1-9]\d{0,4}$/.test(seconds)?Number(seconds)*1000:60000;
 }
}
