# Publishing Figma Plugins

## Pre-Publishing Checklist

### Functionality Testing

- [ ] Works with empty selection
- [ ] Works with single and multiple selection
- [ ] Handles large documents (1000+ layers)
- [ ] Handles deep nesting (10+ levels)
- [ ] No infinite loops or hangs
- [ ] Proper error messages for invalid input
- [ ] `figma.closePlugin()` always called
- [ ] No console errors in production
- [ ] All API calls use async versions (dynamic-page)

### Edge Cases

- [ ] Mixed font styles in text nodes
- [ ] Components and instances
- [ ] Auto layout frames
- [ ] Masked content, images and gradients
- [ ] Locked and hidden layers
- [ ] Variable-bound properties
- [ ] Multi-mode variable collections

### Performance

- [ ] Uses `figma.skipInvisibleInstanceChildren = true`
- [ ] Uses `findAllWithCriteria` over `findAll` where possible
- [ ] Only loads needed pages via `page.loadAsync()`
- [ ] Responsive UI (no freezing)
- [ ] Loading states for async operations

---

## Required Assets

### Plugin Icon
- **Size**: 128 x 128 pixels
- **Format**: PNG or SVG
- **Content**: Recognizable at small sizes, no text

### Cover Image
- **Size**: 1920 x 960 pixels
- **Format**: PNG or JPG

### Screenshots (Optional but Recommended)
- **Size**: 1920 x 1080 pixels (16:9)
- **Count**: Up to 6

---

## Manifest Requirements

### Required for Publishing

```json
{
  "name": "Plugin Name",
  "id": "assigned-by-figma",
  "api": "1.0.0",
  "main": "code.js",
  "editorType": ["figma"],
  "documentAccess": "dynamic-page",
  "networkAccess": {
    "allowedDomains": ["your-api.com"],
    "reasoning": "Clear explanation of why network access is needed"
  }
}
```

### Permissions Justification

- `currentuser` - Personalization, analytics attribution
- `activeusers` - Collaboration features
- `teamlibrary` - Access to shared components/styles/variables
- `fileusers` - Multi-user document features
- `payments` - Monetization features

### Capabilities

- `codegen` - Code generation in Dev Mode
- `inspect` - Custom inspect panels in Dev Mode
- `textreview` - Text review/spell check
- `vscode` - VS Code integration

---

## Payments Setup (Monetization)

### Requirements

1. Add `"payments"` to manifest permissions
2. Implement payment gating in plugin code
3. Configure pricing in Figma Community listing

### Pricing Options

- **One-time purchase**: Minimum $2 USD
- **Monthly subscription**: Minimum $2 USD/month (7-day free trial by default)
- **Yearly subscription**: Minimum $2 USD/year (7-day free trial by default)

### Revenue Share

Figma takes a **15% fee**. Once published as paid, plugins **cannot revert to free**.

### Implementation Pattern

```typescript
async function checkPayment() {
  const status = figma.payments.status;

  if (status.type === 'UNPAID') {
    // Option 1: Hard gate
    await figma.payments.initiateCheckoutAsync({
      interstitial: 'PAID_FEATURE'
    });

    // Option 2: Trial-based
    const secs = figma.payments.getUserFirstRanSecondsAgo();
    if (secs > 7 * 86400) {
      await figma.payments.initiateCheckoutAsync({
        interstitial: 'TRIAL_ENDED'
      });
    }
  }
}
```

### Testing Payments

```typescript
// Development only
figma.payments.setPaymentStatusInDevelopment({ type: 'PAID' });
figma.payments.setPaymentStatusInDevelopment({ type: 'UNPAID' });
```

### Server-Side Verification

```typescript
const token = await figma.payments.getPluginPaymentTokenAsync();
// Send to your server, verify via Figma Payments REST API
```

---

## Review Guidelines

### What Figma Reviews

1. **Functionality** - Plugin works as described
2. **Stability** - No crashes or freezes
3. **Privacy** - Appropriate data handling
4. **Security** - No malicious behavior
5. **Content** - Appropriate for all users
6. **IP** - No trademark/copyright violations

### Naming Guidelines

- Don't include "Figma" in the name
- Don't use trademarked terms
- Don't imply official Figma endorsement
- Use descriptive, unique names

---

## Publishing Process

1. Complete all testing and prepare assets
2. Open Figma Desktop > **Plugins > Development > Manage plugins**
3. Click **...** > **Publish new release**
4. Fill in name (no "Figma"), tagline (80 chars max), description, categories, tags
5. Set pricing: Free or paid (one-time/subscription)
6. Upload icon (128x128) and cover image (1920x960)
7. Submit for review (5-10 business days)

---

## Updates and Versioning

1. Make code changes and test
2. **Plugins > Development > Manage plugins** > **Publish new release**
3. Add release notes and submit

Versioning: Major (breaking), Minor (features), Patch (fixes).

---

## Common Rejection Reasons

### Technical Issues

| Issue | Solution |
|-------|----------|
| Plugin crashes | Add error handling, test edge cases |
| Doesn't close | Ensure `figma.closePlugin()` is called |
| Uses deprecated sync APIs | Migrate to async versions |
| Network requests fail | Verify `networkAccess` in manifest |
| Slow performance | Use `skipInvisibleInstanceChildren`, optimize traversal |

### Manifest Issues

| Issue | Solution |
|-------|----------|
| Missing `documentAccess` | Add `"dynamic-page"` (mandatory) |
| Undeclared domains | Add all domains to `networkAccess` |
| Missing permissions | Declare all required permissions |
| Invalid `editorType` | Use valid: `figma`, `figjam`, `dev`, `slides`, `buzz` |

---

## Post-Publishing

- Check Community page analytics
- Respond to user reviews
- Monitor bug reports and feature requests
- Track revenue (if paid plugin)
- Provide support email or documentation link
