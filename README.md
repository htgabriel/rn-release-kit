# @htgabriel/release-kit

Orquestrador de release reutilizável para apps Expo/EAS. Camada fina sobre `eas build`/`eas submit`/`eas update`, mais clientes Node puro (sem Ruby/fastlane) para App Store Connect e Android Publisher: App Review, notas de versão, promoção para produção e rollout.

```bash
npx @htgabriel/release-kit init
```

O wizard pede credencial após credencial — Expo/EAS, App Store Connect API Key, Google Play service account — valida cada uma contra a API real, e escreve `release-kit.config.json` + `.env.release` (gitignored) só no final. É idempotente: rodar de novo corrige só o que falta.

## Comandos

| Comando | Efeito |
|---|---|
| `init` | Wizard completo de setup |
| `credentials [expo\|apple\|google\|sync]` | Refaz uma etapa isolada do wizard |
| `doctor [--channel] [--platform] [--deep]` | Preflight: git, toolchain, auth, versão remota, fingerprint, expo-doctor |
| `version <patch\|minor\|major\|x.y.z> [--push]` | Bump da versão, commit e tag |
| `notes [--version] [--edit]` | Rascunha (a partir dos commits feat/fix) e abre no `$EDITOR` |
| `build --channel <c> --platform <android\|ios> [--cloud]` | `eas build` local (default) ou cloud |
| `submit --channel <c> [--latest\|--path <arquivo>]` | `eas submit` para a faixa de teste |
| `ship --channel <c> --platform <p>` | doctor → build → submit |
| `promote --channel <c> [--platform]` | Play: teste → produção. Apple: cria e envia a Review Submission |
| `rollout --channel <c> --platform android --to <0-1\|complete\|halt>` | Controla o rollout percentual da Play |
| `status --channel <c>` | Estado da review Apple e das faixas/rollout da Play |
| `update --channel <c> [--message]` | OTA via `eas update` |
| `ci init github` | Gera `.github/workflows/release-kit.yml` |

Canais com `protected: true` (produção) são fail-closed: todo comando que os toca exige `--i-know-this-is-production` (não-interativo) ou `--confirm-version <versão exata>`. Sem uma dessas flags, nada publica em produção — nem `build`, nem `submit`, nem `update` OTA.

Sem subcomando, `release-kit` mostra um menu interativo (só com TTY); em CI/non-interactive mostra o help e nunca publica nada.

## Modelo de canais

Cada canal em `release-kit.config.json` mapeia para um build profile do `eas.json` do projeto, mais os identificadores de loja:

```jsonc
"production": {
  "protected": true,
  "buildProfile": "production",
  "submitProfile": "local-validation", // build vai pra produção, submit fica em Internal/TestFlight até promote
  "ios": { "bundleId": "com.example.app", "phasedRelease": true },
  "android": { "package": "com.example.app", "testTrack": "internal", "productionTrack": "production", "initialRollout": 0.1 },
  "ota": { "channel": "production" }
}
```

Modelo: builda uma vez → `submit` para a faixa de teste → valida → `promote` copia para produção (Play) / cria a Review Submission (Apple), sem reupload de binário.

## Suporte por sistema operacional

| Etapa | macOS | Linux | Windows |
|---|---|---|---|
| Build local iOS | ✅ | ❌ | ❌ |
| Build local Android | ✅ | ✅ | ⚠️ só via WSL2 |
| Build cloud, submit, OTA, review, notas, rollout, status | ✅ | ✅ | ✅ |

`doctor` detecta a limitação e sugere `--cloud` ou WSL2 antes de você tentar buildar.

## Status do projeto

v0.x — extraído do release kit interno do Olho no Lance. Os clientes de App Store Connect e Android Publisher são implementações diretas contra a API pública (JWT assinado com `node:crypto`, sem SDK), e ainda **não foram validados ponta a ponta contra contas reais**. Rode `--dry-run` antes de qualquer `promote`/`review` em produção, e reporte discrepâncias.

## Licença

MIT
