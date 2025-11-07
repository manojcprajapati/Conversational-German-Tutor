import React, { useState, useRef, useEffect, useCallback } from 'react';
import { geminiLiveService } from './services/geminiLiveService';
import { sendMessageStream, generateWelcomeBackMessage } from './services/geminiService';
import { geminiTtsService } from './services/geminiTtsService';
import { Message, Role } from './types';
import { LiveServerMessage } from '@google/genai';

const MicIcon = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6"><path d="M12 18.75a6 6 0 0 0 6-6v-1.5a6 6 0 0 0-12 0v1.5a6 6 0 0 0 6 6ZM12 2.25a.75.75 0 0 1 .75.75v6a.75.75 0 0 1-1.5 0v-6A.75.75 0 0 1 12 2.25ZM18.75 9.75a.75.75 0 0 0-1.5 0v1.5a4.5 4.5 0 0 1-9 0v-1.5a.75.75 0 0 0-1.5 0v1.5a6 6 0 0 0 12 0v-1.5ZM10.5 21a.75.75 0 0 0 0 1.5h3a.75.75 0 0 0 0-1.5h-3Z" /></svg>;
const StopIcon = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6"><path fillRule="evenodd" d="M4.5 7.5a3 3 0 0 1 3-3h9a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3h-9a3 3 0 0 1-3-3v-9Z" clipRule="evenodd" /></svg>;
const SendIcon = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6"><path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z" /></svg>;


function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [deepGrammar, setDeepGrammar] = useState(false);
  const [isLessonStarted, setIsLessonStarted] = useState(false);
  const [liveTranscription, setLiveTranscription] = useState('');


  const currentGenerationId = useRef(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputTranscriptionRef = useRef('');
  const modelTranscriptionRef = useRef('');
  
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(scrollToBottom, [messages]);
  
  const startLesson = async () => {
    geminiTtsService.ensureAudioContextResumed();
    setIsLessonStarted(true);

    const storedMessages = localStorage.getItem('chatHistory');
    if (storedMessages && JSON.parse(storedMessages).length > 0) {
      const parsedMessages: Message[] = JSON.parse(storedMessages);
      setMessages(parsedMessages);
      try {
        const historyForWelcome = parsedMessages
          .filter(msg => msg.role !== Role.ERROR)
          .map(msg => ({
            role: msg.role as 'user' | 'model',
            parts: [{ text: msg.text }],
          }));
        const welcomeMessage = await generateWelcomeBackMessage(historyForWelcome);
        const welcomeMessageObj = { role: Role.MODEL, text: welcomeMessage };
        setMessages(prev => [...prev, welcomeMessageObj]);
        currentGenerationId.current = geminiTtsService.cancel();
        geminiTtsService.speak(welcomeMessage, currentGenerationId.current, (error) => {
          setMessages(prev => [...prev, { role: Role.ERROR, text: `Audio Error: ${error}` }]);
        });
      } catch (e) {
         console.error("Failed to generate welcome message:", e);
         const fallbackMessage: Message = { role: Role.MODEL, text: `Willkommen zurück! Lass uns weitermachen.` };
         setMessages(prev => [...prev, fallbackMessage]);
         currentGenerationId.current = geminiTtsService.cancel();
         geminiTtsService.speak(fallbackMessage.text, currentGenerationId.current, (error) => {
          setMessages(prev => [...prev, { role: Role.ERROR, text: `Audio Error: ${error}` }]);
        });
      }
    } else {
       const initialMessage: Message = { role: Role.MODEL, text: `Hallo! Wie geht es Ihnen?` };
       setMessages([initialMessage]);
       currentGenerationId.current = geminiTtsService.cancel();
       geminiTtsService.speak(initialMessage.text, currentGenerationId.current, (error) => {
         setMessages(prev => [...prev, { role: Role.ERROR, text: `Audio Error: ${error}` }]);
       });
    }
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const newUserMessage: Message = { role: Role.USER, text: input };
    const newMessages = [...messages, newUserMessage];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);
    currentGenerationId.current = geminiTtsService.cancel();

    try {
      const history = newMessages
        .slice(0, -1)
        .filter(msg => msg.role !== Role.ERROR)
        .map(msg => ({
          role: msg.role as 'user' | 'model',
          parts: [{ text: msg.text }],
        }));

      const stream = await sendMessageStream(history, input, deepGrammar);
      let fullResponse = '';
      
      setMessages(prev => [...prev, { role: Role.MODEL, text: '' }]);
      
      let sentenceBuffer = '';

      for await (const chunk of stream) {
        fullResponse += chunk.text;
        sentenceBuffer += chunk.text;

        setMessages(prev => {
          const updatedMessages = [...prev];
          updatedMessages[updatedMessages.length - 1].text = fullResponse;
          return updatedMessages;
        });
        
        const sentenceEndIndex = sentenceBuffer.search(/[.!?]/);
        if (sentenceEndIndex !== -1) {
            const sentence = sentenceBuffer.substring(0, sentenceEndIndex + 1);
            sentenceBuffer = sentenceBuffer.substring(sentenceEndIndex + 1);
            geminiTtsService.speak(sentence, currentGenerationId.current, (error) => {
              setMessages(prev => [...prev, { role: Role.ERROR, text: `Audio Error: ${error}` }]);
            });
        }
      }
      
      if (sentenceBuffer.trim()) {
        geminiTtsService.speak(sentenceBuffer, currentGenerationId.current, (error) => {
          setMessages(prev => [...prev, { role: Role.ERROR, text: `Audio Error: ${error}` }]);
        });
      }
      localStorage.setItem(`chatHistory`, JSON.stringify([...newMessages, { role: Role.MODEL, text: fullResponse }]));

    } catch (error) {
      console.error(error);
      const lastMessage = messages[messages.length -1];
      if (lastMessage.role === Role.MODEL && lastMessage.text === '') {
        setMessages(prev => [...prev.slice(0, -1), { role: Role.ERROR, text: 'An error occurred. Please try again.' }]);
      } else {
        setMessages(prev => [...prev, { role: Role.ERROR, text: 'An error occurred. Please try again.' }]);
      }
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleLiveMessage = useCallback(async (message: LiveServerMessage) => {
    if (message.serverContent?.inputTranscription) {
      const text = message.serverContent.inputTranscription.text;
      inputTranscriptionRef.current += text;
      setLiveTranscription(inputTranscriptionRef.current);
    }
    if (message.serverContent?.outputTranscription) {
       const text = message.serverContent.outputTranscription.text;
       modelTranscriptionRef.current += text;
    }
    if (message.serverContent?.turnComplete) {
      const fullInput = inputTranscriptionRef.current;
      const fullOutput = modelTranscriptionRef.current;

      const newMessages: Message[] = [];
      if (fullInput.trim()) {
        newMessages.push({ role: Role.USER, text: fullInput.trim() });
      }
      if (fullOutput.trim()) {
         newMessages.push({ role: Role.MODEL, text: fullOutput.trim() });
      }

      if (newMessages.length > 0) {
        setMessages(prev => {
            const updatedMessages = [...prev, ...newMessages];
            localStorage.setItem(`chatHistory`, JSON.stringify(updatedMessages));
            return updatedMessages;
         });
      }

      // Reset for the next turn
      inputTranscriptionRef.current = '';
      modelTranscriptionRef.current = '';
      setLiveTranscription('');
    }
  }, []);

  const stopRecording = useCallback(() => {
    setIsRecording(false);
    setLiveTranscription('');
    geminiLiveService.close();
  }, []);

  const startRecording = useCallback(async () => {
    setIsRecording(true);
    setLiveTranscription('Listening...');
    inputTranscriptionRef.current = '';
    modelTranscriptionRef.current = '';

    try {
        await geminiLiveService.connect({
            onopen: () => console.log('Live session opened'),
            onmessage: handleLiveMessage,
            onerror: (e) => {
                console.error('Live session error:', e);
                setMessages(prev => [...prev, { role: Role.ERROR, text: 'Voice chat error. Please try again.' }]);
                stopRecording();
            },
            onclose: (e) => {
                console.log('Live session closed');
            },
        }, deepGrammar);
    } catch (error) {
        console.error("Failed to start recording:", error);
        setMessages(prev => [...prev, { role: Role.ERROR, text: 'Could not access microphone.' }]);
        setIsRecording(false);
        setLiveTranscription('');
    }
  }, [handleLiveMessage, stopRecording, deepGrammar]);


  const toggleRecording = () => {
    currentGenerationId.current = geminiTtsService.cancel();
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };
  
  const clearChat = () => {
    const initialMessage = { role: Role.MODEL, text: `Hallo! Wie geht es Ihnen?` };
    setMessages([initialMessage]);
    localStorage.removeItem(`chatHistory`);
    currentGenerationId.current = geminiTtsService.cancel();
    geminiTtsService.speak(initialMessage.text, currentGenerationId.current, (err) => {});
  }

  if (!isLessonStarted) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-100">
        <div className="text-center bg-white p-10 rounded-lg shadow-2xl">
          <h1 className="text-3xl font-bold mb-4">German Language Tutor</h1>
          <p className="mb-6 text-gray-700">Click below to begin your personalized lesson.</p>
          <button onClick={startLesson} className="bg-blue-600 text-white font-bold py-3 px-6 rounded-lg hover:bg-blue-700 transition-colors text-lg">
            Start Lesson
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      <header className="bg-white shadow-md p-4 flex justify-between items-center z-10">
        <h1 className="text-2xl font-bold text-gray-800">Conversational German Tutor</h1>
        <div className="flex items-center space-x-4">
          <div className="flex items-center">
            <input type="checkbox" id="deepGrammar" checked={deepGrammar} onChange={(e) => setDeepGrammar(e.target.checked)} className="mr-2 h-4 w-4" />
            <label htmlFor="deepGrammar" className="text-gray-700 font-medium">Deep Grammar</label>
          </div>
           <button onClick={clearChat} className="text-sm bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold py-2 px-4 rounded-lg">
            Clear Chat
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="max-w-4xl mx-auto space-y-4">
          {messages.map((msg, index) => (
            <div key={index} className={`flex ${msg.role === Role.USER ? 'justify-end' : 'justify-start'}`}>
              <div className={`p-4 rounded-2xl max-w-lg whitespace-pre-wrap ${
                msg.role === Role.USER ? 'bg-blue-500 text-white rounded-br-none' : 
                msg.role === Role.MODEL ? 'bg-white text-gray-800 shadow-sm rounded-bl-none' : 
                'bg-red-100 text-red-800 border border-red-300'
              }`}>
                 {msg.role === Role.ERROR && <strong className='font-bold'>Error: </strong>}
                 {msg.text}
              </div>
            </div>
          ))}
          {isLoading && <div className="flex justify-start"><div className="p-4 rounded-2xl bg-white text-gray-800 shadow-sm rounded-bl-none">...</div></div>}
          <div ref={messagesEndRef} />
        </div>
      </main>

      <footer className="bg-white border-t p-4">
        <div className="max-w-4xl mx-auto flex items-center space-x-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder={isRecording ? liveTranscription || "Listening..." : "Type your message in German..."}
            className="flex-1 p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 transition-shadow disabled:bg-gray-100"
            rows={1}
            disabled={isRecording}
          />
          <button
            onClick={handleSend}
            disabled={isLoading || isRecording || !input.trim()}
            className="p-3 bg-blue-600 text-white rounded-full hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            <SendIcon />
          </button>
          <button
            onClick={toggleRecording}
            className={`p-3 rounded-full transition-colors ${isRecording ? 'bg-red-500 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
          >
            {isRecording ? <StopIcon /> : <MicIcon />}
          </button>
        </div>
      </footer>
    </div>
  );
}

export default App;