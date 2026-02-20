# Ollama With Docker

## 1. Start Ollama

```bash
docker compose -f docker-compose.model.yml up -d
```

Check container status:

```bash
docker compose -f docker-compose.model.yml ps
```

## 2. Pull a model inside Docker

Pull `llama3`:

```bash
docker exec -it ollama ollama pull llama3
```

List installed models:

```bash
docker exec -it ollama ollama list
```

## 3. Create a custom pre-trained model for financial-chat

Create a custom model with schema/restrictions baked in:

```bash
docker cp ollama/Modelfile.financial-chat ollama:/tmp/Modelfile.financial-chat
docker exec -it ollama ollama create financial-chat-assistant -f /tmp/Modelfile.financial-chat
docker exec -it ollama ollama list
```

Set your Supabase function secret to use this model:

```bash
supabase secrets set OLLAMA_MODEL=financial-chat-assistant --project-ref ljuoftnobrrubrnlgwqa
```

## 4. Test model inference

```bash
curl http://localhost:11434/api/generate -d '{
  "model":"financial-chat-assistant",
  "prompt":"hello",
  "stream":false
}'
```

## 5. Optional cleanup

Stop container:

```bash
docker compose -f docker-compose.model.yml down
```

brew install cloudflared
cloudflared tunnel --url http://localhost:11434 -> https://leader-harley-hunt-enrollment.trycloudflare.com 


curl https://leader-harley-hunt-enrollment.trycloudflare.com/api/generate \
  -H "Content-Type: application/json" \
  -d '{
    "model": "financial-chat-assistant",
    "prompt": "hello",
    "stream": false
  }'
