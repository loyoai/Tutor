// To run this code you need to install the following dependencies:
// npm install @google/genai mime
// npm install -D @types/node

import { GoogleGenAI } from '@google/genai';
import { setDefaultResultOrder } from 'dns';
import mime from 'mime';
import { writeFile } from 'fs';

function saveBinaryFile(fileName: string, content: Buffer) {
  // Write Buffer without encoding to preserve binary data.
  writeFile(fileName, content, (err) => {
    if (err) {
      console.error(`Error writing file ${fileName}:`, err);
      return;
    }
    console.log(`File ${fileName} saved to file system.`);
  });
}

async function main() {
  const startTime = Date.now();

  // Prefer IPv4 to avoid certain DNS/IPv6 fetch failures on macOS/Node 22.
  try {
    setDefaultResultOrder('ipv4first');
  } catch {}

  const apiKey = "AIzaSyD4TcrFJUHvvOHy7Wm1plGbZsk8zqOCXEM";
  if (!apiKey) {
    console.error('Missing GEMINI_API_KEY or API_KEY in environment.');
    console.error('Set it (e.g., `export GEMINI_API_KEY=...`) and retry.');
    process.exit(1);
  }

  const ai = new GoogleGenAI({ apiKey });

  const config = {
    temperature: 1,
    responseModalities: ['audio'],
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName: 'Zephyr',
        },
      },
    },
  } as const;

  const model = 'gemini-2.5-pro-preview-tts';
  const contents = [
    {
      role: 'user',
      parts: [
        {
          text:
            'The old wooden bridge creaked softly as the wind carried the scent of pine across the valley.',
        },
      ],
    },
  ];

  try {
    const response = await ai.models.generateContentStream({
      model,
      config,
      contents,
    });

    let fileIndex = 0;
    for await (const chunk of response) {
      if (!chunk.candidates || !chunk.candidates[0].content || !chunk.candidates[0].content.parts) {
        continue;
      }
      if (chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData) {
        const fileName = `tts_output_${fileIndex++}`;
        const inlineData = chunk.candidates[0].content.parts[0].inlineData;
        let fileExtension = mime.getExtension(inlineData.mimeType || '');
        let buffer = Buffer.from(inlineData.data || '', 'base64');
        if (!fileExtension) {
          fileExtension = 'wav';
          buffer = convertToWav(inlineData.data || '', inlineData.mimeType || '');
        }
        saveBinaryFile(`${fileName}.${fileExtension}`, buffer);
      } else if (chunk.text) {
        console.log(chunk.text);
      }
    }
  } catch (err: any) {
    console.error('Request failed:', err?.message || err);
    if (err?.status === 429) {
      console.error('Hit rate/quota limit. Wait or use a paid plan.');
    }
    if (/fetch failed/i.test(String(err?.message))) {
      console.error('Network error. Check connectivity, proxies, or IPv6 DNS.');
      console.error('If on macOS, try: `export NODE_OPTIONS=--dns-result-order=ipv4first`');
    }
    process.exit(1);
  }

  const seconds = (Date.now() - startTime) / 1000;
  console.log(`Time taken (s): ${seconds.toFixed(3)}`);
}

main();
  
  interface WavConversionOptions {
    numChannels : number,
    sampleRate: number,
    bitsPerSample: number
  }
  
  function convertToWav(rawData: string, mimeType: string) {
    const options = parseMimeType(mimeType)
    const wavHeader = createWavHeader(rawData.length, options);
    const buffer = Buffer.from(rawData, 'base64');
  
    return Buffer.concat([wavHeader, buffer]);
  }
  
  function parseMimeType(mimeType : string) {
    const [fileType, ...params] = mimeType.split(';').map(s => s.trim());
    const [_, format] = fileType.split('/');
  
    const options : Partial<WavConversionOptions> = {
      numChannels: 1,
    };
  
    if (format && format.startsWith('L')) {
      const bits = parseInt(format.slice(1), 10);
      if (!isNaN(bits)) {
        options.bitsPerSample = bits;
      }
    }
  
    for (const param of params) {
      const [key, value] = param.split('=').map(s => s.trim());
      if (key === 'rate') {
        options.sampleRate = parseInt(value, 10);
      }
    }
  
    return options as WavConversionOptions;
  }
  
  function createWavHeader(dataLength: number, options: WavConversionOptions) {
    const {
      numChannels,
      sampleRate,
      bitsPerSample,
    } = options;
  
    // http://soundfile.sapp.org/doc/WaveFormat
  
    const byteRate = sampleRate * numChannels * bitsPerSample / 8;
    const blockAlign = numChannels * bitsPerSample / 8;
    const buffer = Buffer.alloc(44);
  
    buffer.write('RIFF', 0);                      // ChunkID
    buffer.writeUInt32LE(36 + dataLength, 4);     // ChunkSize
    buffer.write('WAVE', 8);                      // Format
    buffer.write('fmt ', 12);                     // Subchunk1ID
    buffer.writeUInt32LE(16, 16);                 // Subchunk1Size (PCM)
    buffer.writeUInt16LE(1, 20);                  // AudioFormat (1 = PCM)
    buffer.writeUInt16LE(numChannels, 22);        // NumChannels
    buffer.writeUInt32LE(sampleRate, 24);         // SampleRate
    buffer.writeUInt32LE(byteRate, 28);           // ByteRate
    buffer.writeUInt16LE(blockAlign, 32);         // BlockAlign
    buffer.writeUInt16LE(bitsPerSample, 34);      // BitsPerSample
    buffer.write('data', 36);                     // Subchunk2ID
    buffer.writeUInt32LE(dataLength, 40);         // Subchunk2Size
  
    return buffer;
  }
  
