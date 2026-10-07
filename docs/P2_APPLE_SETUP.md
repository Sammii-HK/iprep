# P2: Apple Developer setup for native sign-in

Nothing here has been done. Claude cannot do the Apple-side steps and none are claimed as configured.

## Values already in the code (nothing to invent)

| Value | Where it already is |
| --- | --- |
| Bundle identifier `app.lunary.iprep` | iOS `project.yml` (`PRODUCT_BUNDLE_IDENTIFIER`) |
| Team ID `ASG43SHM5N` | iOS `project.yml` (`DEVELOPMENT_TEAM`) |
| Sign in with Apple entitlement (`com.apple.developer.applesignin` = `Default`) | iOS `iPrep.entitlements` (and `project.yml`) |
| Token audience the server accepts: `app.lunary.iprep` | server default in `lib/native/apple.ts` (`APPLE_CLIENT_ID`, unset means the bundle id) |
| Notification route | server `app/api/auth/native/apple/notifications/route.ts` |

Native Sign in with Apple needs **no callback URL, no Services ID, no client secret, no private key and no key ID**. The app
asks Apple for an identity token on the device and the server verifies its signature against Apple's public keys
(`https://appleid.apple.com/auth/keys`). Nothing secret is configured on the server for sign-in. (A Services ID and a
`.p8` key would only be needed for web sign-in with Apple or for calling Apple's token endpoint, which P2 does not do.)

## Actions only you can perform

1. **Enable the capability on the App ID.** developer.apple.com, Certificates, Identifiers & Profiles, Identifiers,
   `app.lunary.iprep`, tick **Sign in with Apple**, Save. Choose *Enable as a primary App ID*.
2. **Refresh signing.** Let Xcode manage signing (Signing & Capabilities for the iPrep target shows Sign in with Apple), or
   regenerate and install the provisioning profile. Without this the entitlement in the build is rejected on device.
3. **Set the server-to-server notification endpoint.** Same Identifier, Sign in with Apple, **Edit**, field *Server to Server
   Notification Endpoint*, enter `https://iprep-five.vercel.app/api/auth/native/apple/notifications` (use the final
   production host if you serve the app from a custom domain; it must be HTTPS and publicly reachable). Save.
   Apple sends signed notifications there for `consent-revoked` and `account-delete`. The route verifies Apple's JWT
   itself, so there is no shared secret. Do this only when Production is ready to receive it (the route exists only
   after P2 is deployed); until then leave it blank.
4. **Confirm the build identifiers match** in Xcode (bundle id and team above). A mismatch makes Apple's tokens carry a different
   audience and the server will refuse them (`INVALID_APPLE_TOKEN`).

## What Claude can do after you have done the above

- verify the notification endpoint with a signed test event once Production has the route;
- set `APPLE_CLIENT_ID` in Vercel only if the bundle id ever changes (it is unset today, and should stay unset);
- generate invite codes for testers (`scripts/native-invites.ts`) on the environment you name;
- run the first real-device test with you (docs/P2_NATIVE_E2E_RUNBOOK.md) and record the evidence;
- publish the bundled catalog to the environment you name (`scripts/publish-catalog.ts`).

## Order

Preview first (App ID capability and signing are enough; the notification endpoint can stay blank), then Production only after
the cutover approval and the Production migration (docs/P2_GATES_AND_DEBT.md, section 1).
