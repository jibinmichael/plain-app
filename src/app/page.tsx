import Editor from "@/components/Editor";

export default function Home() {
  return (
    <main className="app">
      <div className="editor-scroll">
        <div className="editor-column">
          <Editor />
        </div>
      </div>
    </main>
  );
}
