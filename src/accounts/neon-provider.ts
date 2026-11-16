import {AccountFailure,type AccountProvider,type AccountUser,createAccountController} from './account-controller';
function checked(result:{error?:{code?:string}|null}){if(result.error)throw new AccountFailure(result.error.code??'NETWORK');}
function userOf(value:unknown):AccountUser|null {
 if(value===null)return null;
 if(!value||typeof value!=='object')throw new AccountFailure('INVALID_RESPONSE');
 const {session,user}=value as {session?:unknown;user?:Record<string,unknown>};
 if(!session||!user||typeof user.id!=='string'||!user.id||typeof user.email!=='string'||typeof user.name!=='string'||typeof user.emailVerified!=='boolean')throw new AccountFailure('INVALID_RESPONSE');
 return {id:user.id,name:user.name,email:user.email,verified:user.emailVerified};
}
async function createProvider():Promise<AccountProvider>{
 const {createAuthClient}=await import('@neon/auth');
 const {BetterAuthVanillaAdapter}=await import('@neon/auth/vanilla/adapters');
 const client=createAuthClient(window.location.origin+'/api/account-auth',{adapter:BetterAuthVanillaAdapter({fetchOptions:{retry:0,timeout:15000}})});
 const callback=window.location.origin+'/?pulso-account=callback';
 return {
  async session(){const r=await client.getSession({fetchOptions:{cache:'no-store'}});checked(r);return userOf(r.data);},
  async signIn(email,password){checked(await client.signIn.email({email,password,rememberMe:true}));},
  async signUp(name,email,password){checked(await client.signUp.email({name,email,password,callbackURL:callback}));},
  async google(){checked(await client.signIn.social({provider:'google',callbackURL:callback}));},
  async signOut(){checked(await client.signOut());},
  async requestReset(email){checked(await client.requestPasswordReset({email,redirectTo:window.location.origin+'/?pulso-account=reset'}));},
  async reset(token,newPassword){checked(await client.resetPassword({token,newPassword}));},
  async verify(email,otp){checked(await client.$fetch('/email-otp/verify-email',{method:'POST',body:{email,otp}}));},
  async resend(email){checked(await client.$fetch('/email-otp/send-verification-otp',{method:'POST',body:{email,type:'email-verification'}}));},
 };
}
export const accountController=createAccountController({
 async config(){const r=await fetch('/account-config.json',{cache:'no-store',credentials:'same-origin',redirect:'error',signal:AbortSignal.timeout(5000)});if(!r.ok)throw new AccountFailure('NETWORK');const raw=await r.text();if(raw.length>512)throw new AccountFailure('INVALID_RESPONSE');const v=JSON.parse(raw);if(v.version!==1||typeof v.enabled!=='boolean'||typeof v.google!=='boolean')throw new AccountFailure('INVALID_RESPONSE');return v;},
 provider:createProvider,
});
