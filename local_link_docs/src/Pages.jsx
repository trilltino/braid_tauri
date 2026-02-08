import DocsLayout from './components/Docs/DocsLayout'
import { WikiEditor } from './pages_editor'

const Pages = () => {
  return (
    <DocsLayout fullWidth={true}>
      <WikiEditor />
    </DocsLayout>
  )
}

export default Pages
